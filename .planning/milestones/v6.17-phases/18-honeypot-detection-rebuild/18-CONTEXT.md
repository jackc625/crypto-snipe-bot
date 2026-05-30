# Phase 18: Honeypot Detection Rebuild - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the broken pre-buy honeypot detection stack so the bot can again
snipe V2 and V3 tokens on live mainnet with real money. The current
`simulateSellForChain` (V2) hard-blocks every snipe by passing `balance=0`
to the router; `simulateSellV3ForChain` (V3) silently returns `true` via a
zero-balance vacuous-pass guard. Both code paths are deleted and replaced
in-place with a new dispatch into a self-controlled, immutable
`HoneypotChecker.sol` contract that does a real buy→sell roundtrip with
post-trade balance/ETH sanity checks, deployed on all 4 enabled chains
(ETH first, then BSC/Base/Arb after live validation).

Architecture is **CLOSED by research convergence** (STACK + ARCHITECTURE +
PITFALLS): Option D primary, Option C as opt-in fallback only. The phase
also performs an audit pass on the other 8 parallel-bank gates in
`tokenSafety.ts` for `amountIn=0`/vacuous-pass siblings (HONEY-11), and
ships a minimal bytecode selector-presence flagging in the parallel bank
as **new requirement HONEY-12**.

**Real capital is live on mainnet today** (~0.0124 ETH funded,
`ENABLED_CHAINS=eth`); the bot cannot snipe any V2 token until this
phase ships. Owner explicitly rejected vacuous-pass shortcuts. All
decisions below prioritize capital safety over throughput, ship-speed,
or code-cleanliness.

</domain>

<decisions>
## Implementation Decisions

### HoneypotChecker.sol scope (HONEY-01, HONEY-09, HONEY-10)

- **D-CONTRACT-SCOPE:** Roundtrip + post-trade sanity assertions
  (~100-120 LOC). Inside one `eth_call`: approve router for WETH, buy via
  router measuring buy-tax bps, **assert post-buy `balanceOf(this) > 0`**
  (catches lying-balanceOf modern honeypot pattern), approve router for
  tokens, sell via router measuring sell-tax bps, **assert post-sell
  `address(this).balance > preBalance`** (catches silent-zero-ETH-on-sell),
  revert at end with ABI-encoded `(buyTaxBps, sellTaxBps, success)` payload.
  Strictly more bugs caught than bare roundtrip (Option 1); does NOT bundle
  max-wallet/blacklist/tax checks (Option 3) to preserve defense-in-depth —
  the parallel-bank gates stay as independent backup layers under HONEY-11
  audit.

- **D-CONTRACT-IMMUTABLE:** Contract is immutable; no owner key, no UUPS
  proxy, no killSwitch. Patch path: deploy v2 at a new address, switch
  `chainRegistry[chain].honeypotChecker.deployedAddress`, restart bot.
  Audit surface stays minimal; eliminates owner-key-compromise risk;
  governance attack surface is zero by construction.

- **D-CONTRACT-ROLLOUT:** ETH mainnet first (HONEY-03), run 2-3 days of
  live observation with the bot's actual config and a known-good +
  fixture-honeypot validation pair, then batch-deploy BSC/Base/Arb
  (HONEY-04). Bot currently runs `ENABLED_CHAINS=eth`, so capital exposure
  is single-chain throughout rollout. A contract bug surfaces on one chain
  instead of four.

### Multi-amount aggregation (HONEY-10) and unknown-verdict policy (HONEY-06)

- **D-AGGREGATION:** Strict at 50%/100% probes, advisory at 1%. Any
  probe-revert OR above-threshold tax at the 50% or 100% probe → overall
  `unsafe`. A 1% probe revert is logged structured (pino) and surfaced in
  the evidence object but does NOT block — tolerates dust-amount math
  edge cases on very small snipe sizes (e.g., `ETH_SNIPE_AMOUNT=0.003` →
  1% = 0.00003 ETH, common dust-revert range). 50%/100% are the gating
  signal; 1% catches amount-tiered tax progression as information.

- **D-TAX-THRESHOLDS:** Default 10% buy / 10% sell (1000 bps each), per
  chain via env (`ETH_MAX_BUY_TAX_BPS`, `ETH_MAX_SELL_TAX_BPS`,
  `BSC_MAX_BUY_TAX_BPS`, etc.). Conservative for current-cycle market
  (allows 5% built-in-tax mainstream meme tokens; blocks heavy-extraction
  tokens). Operator can override per chain in `.env` before going live;
  defaults are committed in `chainRegistry.ts` `CHAIN_TEMPLATES`.

- **D-UNKNOWN-POLICY:** `unknown` verdict triggers one-shot skip — no
  retry, no fallback to parallel bank. Bot logs structured pino + sends
  Telegram alert with reason, marks the pair as skipped for this
  detection event, moves on. Strictest fail-closed semantic; aligned with
  HONEY-06. New pair-detected events re-evaluate from scratch (no
  per-token state retention).

### safetyBank audit (HONEY-11)

- **D-AUDIT-TIMING:** Audit runs in parallel with contract authoring as
  its own track (wave 0 / 1). Findings are converted to HONEY-12+ REQ-IDs
  as discovered. HONEY-07/08 (the `bot.ts:220-226` and `bot.ts:411-416`
  in-place replacements) close only AFTER both: (a) the deployed contract
  is live on the first chain, AND (b) all audit-discovered fixes are
  merged. Bot stays broken on V2 throughout Phase 18 — owner accepts this
  in exchange for a single coherent ship at phase close.

- **D-AUDIT-BAR:** For each of the 8 parallel-bank gates (buy-sim, tax
  check, max-wallet, blacklist, liquidity-sufficiency, metadata,
  transfer-tax, blocklist): (a) code-read to verify the gate exercises
  the underlying behavior (NOT just method-name probing), (b) add a
  regression test that would fail if the gate ever regressed to
  vacuous-pass. Matches Phase 17 D-04 observable-effect rigor. Tests +
  findings committed in `.planning/milestones/v6.17-safety-bank-audit.md`.

### Bytecode static analysis (new HONEY-12) and briefing disposition

- **D-BYTECODE:** Ship a minimal bytecode selector-presence scan in
  Phase 18 as new requirement **HONEY-12**. New function
  `isMutableTokenForChain(ctx, token)`: pulls `getCode(token)`, greps for
  4-byte selectors `setTax`, `setBuyTax`, `setSellTax`, `setBlacklist`,
  `setMaxWallet`, `excludeFromFees`, `pauseTrading`. Adds an evidence
  field to the parallel-bank verdict; a positive hit blocks the buy
  (closes the "owner flips tax mid-position" attack vector that the
  roundtrip can't catch). ~50 LOC, no contract deploy, no audit.

- **D-BRIEFING-DISPOSITION:** `HONEYPOT-SIM-BRIEFING.md` (currently at
  repo root) is **deleted** at Phase 20 OPS-LIVE-13 — superseded by
  shipped code + REQUIREMENTS.md (HONEY-01..12) + research/ docs. The
  briefing's value was pre-implementation rationale; once Phase 18
  ships, the rationale lives in this CONTEXT.md and `.planning/research/
  SUMMARY.md`. Disposition logged here; deletion executes in Phase 20.
  OPS-LIVE-13 changes from "decide disposition" to "execute the delete".

### Test fixture strategy (HONEY-08 success criterion)

- **D-FIXTURE:** Use **both** a contrived test contract and 1-2 real
  pinned mainnet honeypots. Contrived contract (`test/fixtures/contracts/
  Honeypot.sol`, minimal Solidity: `transfer()` reverts conditionally)
  deployed in fork tests covers controlled/repeatable/fast assertions of
  every Phase 18 verdict path. Plus 1-2 historical real honeypots pinned
  to a specific block in `test/fork/fixtures/honeypots/{slug}.json` —
  catches real-world patterns the contrived contract might miss
  (post-block-N tax flip, selective-blacklist by deployer address, etc.).
  Researcher identifies specific historical honeypots during research-phase.

### Operational ops decisions

- **D-DEPLOY-KEY:** New env var `DEPLOY_PRIVATE_KEY` for the Hardhat
  Ignition deploy script. Operator funds a separate deploy wallet with
  ~$10-20 of native gas across 4 chains, runs the per-chain deploy
  scripts, then rotates the key out of `.env`. Bot wallet (snipe trading
  key) never has deploy authority. Mitigates: if the bot wallet key leaks,
  the attacker drains funds but CANNOT deploy a malicious checker at
  trusted addresses. Operational discipline; one-time setup cost.

- **D-ALERTS:** Tiered Telegram alert content. On **skip**: verdict +
  1-line reason + `buyTaxBps`/`sellTaxBps` if measured + token address +
  Etherscan link. Example: `SKIP \`{token}\` — unsafe (sell revert at
  50% probe) tax: buy 30bps sell — `. On **safe**: minimal existing
  format (token detected, going to buy). Operator gets actionable signal
  without alert fatigue; full evidence stays in pino + SQLite for
  post-mortem.

- **D-ROLLBACK:** Git-revert + redeploy; no legacy-code fallback flag.
  Phase 18 **deletes** `simulateSellForChain` and `simulateSellV3ForChain`
  entirely (no `SAFETY_USE_LEGACY_SIM=true` flag retained). If the new
  checker misclassifies in production, operator git-reverts the
  `bot.ts` + `tokenSafety.ts` + `chainRegistry.ts` changes, restarts the
  bot. Bot returns to v6.16 broken-on-V2 state but won't make bad trades.
  Surgical disable via `ENABLED_CHAINS=eth` (etc.) remains available for
  per-chain mitigation if a checker contract has chain-specific issues.

### Stop-the-line convention (carried forward from Phase 17 D-07)

- **D-STOP-THE-LINE:** If the HONEY-11 audit OR a Phase 18 regression test
  reveals a production bug worse than the V2/V3 sell-sim ones (e.g., a
  gate that grants buys when it shouldn't), the bug BLOCKS Phase 18 close.
  Treated as a first-class v6.17 requirement upgrade (likely HONEY-13+ or
  a decimal phase 18.1). Fix-in-flight (scope creep) and file-and-defer
  (rubber-stamp) are explicitly rejected. Matches Phase 17 precedent.

### Claude's Discretion

- Exact Solidity revert-encoding shape (custom error vs abi-encoded
  bytes32 payload vs single uint256 packed) — planner discretion within
  the constraint that ethers v6 must decode it cleanly via
  `Interface.decodeErrorResult` or `provider.send` raw return.
- `eth_call` "balance source" for the test buyer (state-override via
  call params vs contract pre-funded WETH at deploy vs `msg.value`
  + WETH.deposit inside the call) — researcher recommendation, planner
  decides; must work on the bot's existing Alchemy/Infura tier.
- Slither/Mythril command-line flags, severity thresholds, false-positive
  triage policy — auditor discretion within HONEY-02 requirement that
  flagged issues are triaged with documented disposition.
- Hardhat Ignition module file shape (`ignition/modules/HoneypotChecker.ts`),
  per-chain deploy script wrapper structure — smallest-diff path
  recommended.
- Specific regression-test assertion text and fixture token selection
  for HONEY-11 (per gate) — planner + executor discretion within the
  Phase 17 D-04 observable-effect rigor bar.
- Real-mainnet honeypot fixture token selection (which historical
  honeypots, which block-pin) — researcher identifies candidates during
  research-phase; planner finalizes.
- Whether to emit Telegram alerts on a successful safe verdict (current
  bot does; question is whether the existing format is sufficient) —
  D-ALERTS keeps existing format; planner may refine.
- Pre-existing alert format for `*New Token Detected!*` at `bot.ts:268`
  vs proposed evidence-rich format — planner aligns the new evidence
  fields with the existing structure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v6.17 milestone source-of-truth
- `.planning/PROJECT.md` — v6.17 milestone scope; "Current State" section;
  owner non-negotiables ("rejected vacuous-pass shortcuts", "real money")
- `.planning/REQUIREMENTS.md` HONEY-01..HONEY-11 — full success criteria;
  expanded with HONEY-12 in this phase per D-BYTECODE
- `.planning/ROADMAP.md` §"Phase 18: Honeypot Detection Rebuild" — goal,
  depends-on, requirements, 5 success criteria
- `.planning/STATE.md` — milestone status, recent activity

### Research convergence (architectural decisions are CLOSED here)
- `.planning/research/SUMMARY.md` §"Decision: Option C vs Option D —
  Closed (D)" — convergent rationale across STACK/ARCHITECTURE/PITFALLS;
  also §"Critical Pitfalls (Top per Category)" #1, #6 for HONEY
- `.planning/research/STACK.md` — version compatibility matrix; ethers
  v6.16.0 + Hardhat 2.26 + OZ contracts ^5.4.0 confirmed; `eth_simulateV1`
  multi-chain coverage gaps (Option C verdict)
- `.planning/research/ARCHITECTURE.md` — integration design; `src/utils/
  honeypot/` module layout; `ChainConfig.honeypotChecker` extension
  pattern; bot.ts wire-up at lines 220-226 (V2) and 411-416 (V3)
- `.planning/research/PITFALLS.md` #1 (vacuous-pass regression), #5
  (mutable-tax-setter selector scan), #6 (sell-direction-only sim
  fallacy), #19 (retroactive validation rubber-stamping)
- `.planning/research/FEATURES.md` — table-stakes vs differentiator
  classification; honeypot detection feature landscape

### Phase 17 carry-forward (precedent set in DEBT phase)
- `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md`
  D-04 (observable-effect rigor), D-07 (stop-the-line), D-08/09 (CI
  guards as evergreen invariants) — conventions Phase 18 inherits
- `.planning/milestones/v6.17-debt-baseline.md` — established
  CI-verified-baseline pattern; HONEY-11 audit-doc follows same shape

### Briefing document (delete at Phase 20 per D-BRIEFING-DISPOSITION)
- `HONEYPOT-SIM-BRIEFING.md` — original bug write-up + option A/B/C/D
  evaluation. Decision rationale (why D over C, why not A/B) preserved
  in this CONTEXT.md and research/SUMMARY.md. Deletion executes in
  Phase 20 OPS-LIVE-13.

### Code modification targets
- `src/utils/tokenSafety.ts:555-586` — `simulateSellForChain` (V2,
  broken `balance=0` hard-block) — **DELETE** in this phase
- `src/utils/tokenSafety.ts:593-634` — `simulateSellV3ForChain` (V3,
  vacuous-pass at line 603-606) — **DELETE** in this phase
- `src/utils/tokenSafety.ts` (full file) — HONEY-11 audit target; other
  8 gates: `checkHoneypotForChain`, `isBlacklistedTokenForChain`,
  `isLiquidityLockedForChain`, `isLiquiditySufficientForChain`,
  `checkTokenMetadataForChain`, `simulateSwapForChain` (buy-sim),
  `hasHighTransferTaxForChain`, `hasMaxWalletOrTxLimitsForChain`
- `src/bot.ts:220-226` — V2 honeypot gate; **replace in-place** with new
  `simulateHoneypotRoundtrip()` dispatch (HONEY-07)
- `src/bot.ts:411-416` — V3 honeypot gate; **replace in-place** (HONEY-08)
- `src/bot.ts:229-238` — parallel safety bank; **unchanged** in semantics
  but adds HONEY-12 selector-scan gate to the Promise.all
- `src/bot.ts:268` — `*New Token Detected!*` Telegram alert format;
  augment with new evidence fields per D-ALERTS
- `src/chainRegistry.ts` — add `honeypotChecker: { deployedAddress,
  method: 'on-chain-contract' | 'eth_simulateV1' }` to
  `CHAIN_TEMPLATES['eth'|'bsc'|'base'|'arb']`; per-chain max-tax-bps
  envs defaulting to 1000 each per D-TAX-THRESHOLDS

### New artifacts (Phase 18 creates these)
- `contracts/honeypot/HoneypotChecker.sol` — ~100-120 LOC Solidity
  (D-CONTRACT-SCOPE Option 2); compiled under existing solc 0.8.28
- `ignition/modules/HoneypotChecker.ts` — Hardhat Ignition module
- `scripts/deploy-honeypot-checker.ts` — per-chain deploy wrapper using
  `DEPLOY_PRIVATE_KEY` env per D-DEPLOY-KEY
- `src/utils/honeypot/index.ts` — dispatch layer; reads
  `chainRegistry[chain].honeypotChecker.method`
- `src/utils/honeypot/checkerContract.ts` — Option-D wrapper; `eth_call`
  against deployed contract; decodes revert-encoded result
- `src/utils/honeypot/simulator.ts` — Option-C stub/skeleton only
  (research SUMMARY: "build the dispatch layer, leave the implementation
  a stub or thin wrapper until needed")
- `src/utils/honeypot/types.ts` — discriminated union `HoneypotResult`
  with `verdict: 'safe' | 'unsafe' | 'unknown'` + evidence object
- `src/utils/bytecodeAnalysis.ts` (or co-located in tokenSafety) —
  `isMutableTokenForChain` HONEY-12 selector scan
- `test/fixtures/contracts/Honeypot.sol` — contrived test honeypot for
  fork tests (D-FIXTURE controlled fixture)
- `test/fork/fixtures/honeypots/*.json` — 1-2 real pinned mainnet
  honeypot fixtures (D-FIXTURE real fixture)
- `.planning/milestones/v6.17-honeypot-checker-audit.md` — Slither +
  Mythril audit report (HONEY-02)
- `.planning/milestones/v6.17-safety-bank-audit.md` — HONEY-11 8-gate
  audit findings (D-AUDIT-BAR per gate)

### Test infrastructure context
- `vitest.config.ts` — existing projects: unit / integration / fork.
  Phase 18 tests file into appropriate project; no new project needed.
- `package.json` scripts — `test:unit` / `test:integration` / `test:fork`
  / `test:all` already wired. HONEY tests follow this convention.
- `hardhat.config.ts` — solc 0.8.28 + Hardhat 2.26 already configured.
- `.github/workflows/test.yml` — Phase 17 evergreen CI guards (`.todo`
  ban + `tsc --noEmit ×3`) already locked in. Phase 18 adds: Hardhat
  compile gate (`npx hardhat compile`) on contract changes; Slither
  + Mythril gate on `contracts/**` changes per HONEY-02.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Existing parallel-bank dispatch pattern** at `src/bot.ts:229-238`
  (`Promise.all([...])`) — HONEY-12 selector scan slots in here as the
  9th gate. Pattern is established; no architectural change needed.
- **`ChainConfig` per-chain field-extension pattern** — used throughout
  v6.16 for MEV strategy, native currency, explorer URL, etc.
  `honeypotChecker.{deployedAddress, method}` follows the same shape.
- **`sendTxWithRetry` + Flashbots dynamic relay** at `src/bot.ts:294+`
  for buy transactions — unchanged by Phase 18; the new gate sits in
  the safety pipeline upstream.
- **`sendCtxAlert` + structured pino logging** — already used across
  `bot.ts` for skips. D-ALERTS extends existing format with new evidence
  fields; no new infrastructure needed.
- **Hardhat 2.26 + Ignition + OZ contracts ^5.4.0** — already in
  `package.json`; `HoneypotChecker.sol` adds no new dev-dep.
- **better-sqlite3 schema migration framework** — already wired in
  `src/utils/db.ts`. Phase 18 does NOT add schema migration (anti-rug
  schema v4→v5 is Phase 19). Honeypot evidence persists in existing
  `trades` audit fields, not new tables.
- **`canSnipe` risk gate** at `bot.ts:213` (before sell-sim) — runs
  upstream of the new HoneypotChecker dispatch. Order preserved.
- **`isKnownBadTokenForChain`** at `bot.ts:205` — existing first-pass
  blocklist check, runs before HoneypotChecker. Order preserved.

### Established Patterns

- **Discriminated-union return types** are NOT yet established in the
  codebase — current safety gates return `Promise<boolean>`. Phase 18
  introduces this pattern for `HoneypotResult`; planner must choose
  whether the other 8 gates' return types evolve to match (likely yes,
  given HONEY-11 audit + D-AUDIT-BAR regression tests) or stay
  `Promise<boolean>` for stability.
- **Per-chain env-overridable thresholds** — pattern from `ETH_SNIPE_AMOUNT`,
  `ETH_MAX_CAPITAL`, etc. is the template for the new
  `ETH_MAX_BUY_TAX_BPS` / `ETH_MAX_SELL_TAX_BPS` envs per chain.
- **In-place gate replacement** at `bot.ts:220-226` / `bot.ts:411-416`
  — preserves "always-on hard block before parallel bank" FIX-04
  semantic. Surrounding flow (risk-gate → hard-block-honeypot →
  parallel-bank) is unchanged.
- **Test layout** — `test/unit/`, `test/integration/`, `test/fork/`
  with fixtures co-located. New `test/fixtures/contracts/Honeypot.sol`
  follows the existing `test/fixtures/` convention.
- **Hardhat compile + test workflow** — `npx hardhat compile` already
  works on existing contracts (none currently). The new
  `contracts/honeypot/` dir follows that path.

### Integration Points

- **`bot.ts:220-226` (V2)** — atomic in-place replacement: delete
  `simulateSellForChain` call, replace with `simulateHoneypotRoundtrip(
  ctx, dex.routerAddress, targetToken)`. Telegram alert + structured
  pino log line follow D-ALERTS tiered format.
- **`bot.ts:411-416` (V3)** — same atomic replacement; dispatch reads
  router/quoter from `ctx.chain` (no new chain-config plumbing required
  beyond the new `honeypotChecker` field).
- **`bot.ts:229-238` (parallel bank)** — adds 9th element to the
  Promise.all: `isMutableTokenForChain(ctx, targetToken)` (HONEY-12).
  The line-271 `if (isHoneypot || isBlacklisted || …)` condition
  extends to `|| isMutable`.
- **`chainRegistry.ts` `CHAIN_TEMPLATES`** — adds `honeypotChecker`
  field; each chain's deployed address gets filled in atomically with
  that chain's HONEY-03/HONEY-04 deploy commit.
- **`canSnipe` risk gate** — unchanged. Sits upstream of HoneypotChecker.
- **`exitEngine` sell pipeline** — unchanged. Phase 18 is pre-buy only.
  Phase 19 ANTIRUG extends `executeFullSell` with new `reason: 'anti-rug'`
  discriminant; Phase 18 sets no precedent that conflicts.
- **Dashboard** — Phase 18 adds new evidence fields to skip-log
  emissions. Dashboard's existing trade-history / risk display reads
  from SQLite; planner decides whether evidence fields surface on the
  dashboard now (likely "no" for Phase 18; deferred to Phase 21 or v6.18
  dashboard pass).
- **Telegram listener** — unchanged. Outbound alerts only.

</code_context>

<specifics>
## Specific Ideas

- **Owner's binding constraint:** "If it is better and safer, then we
  take that option. This is real capital being traded, we should keep
  that in mind when making decisions." Every D-* above is graded against
  capital safety first, throughput/LOC/clean-code second.
- **Real-mainnet deploy honeypot:** Owner wants 1-2 real historical
  honeypot fixtures pinned to specific blocks (not just contrived
  Solidity tests). Researcher identifies candidates during research-phase.
- **Permission-of-deploy separation:** Bot wallet (snipe trading key) and
  deploy wallet (`DEPLOY_PRIVATE_KEY`) are explicitly separated. Deploy
  key rotates out of `.env` after one-time use. Owner's stance on key
  custody.
- **No legacy fallback retention:** Phase 18 DELETES `simulateSellForChain`
  and `simulateSellV3ForChain` entirely. Owner accepts the lockup risk
  ("if new checker misbehaves, git revert and bot returns to broken-on-V2
  state") rather than maintain dual code paths indefinitely. Reduces
  audit drift; aligned with D-13/D-14 type-safety preferences from Phase
  17.

</specifics>

<deferred>
## Deferred Ideas

- **Owner-renunciation / tax-setter timelock checks** — beyond
  selector-presence (HONEY-12 minimal). v6.18+ scope, tracked in
  REQUIREMENTS.md HONEY-V2-02. Selector scan tells you a setter exists;
  full timelock-state inspection requires per-pattern detection logic.
- **N-of-M consensus across own simulator + third-party APIs** — own
  simulator has veto. HONEY-V2-03 in v6.18+. Phase 18 keeps existing
  third-party APIs in the parallel bank but doesn't promote them to
  veto rights.
- **Option C (`eth_simulateV1`) full implementation** — Phase 18 ships
  the dispatch layer + a stub/skeleton only. v6.18+ activates if a
  specific chain's Option D deploy path is genuinely blocked.
- **Tax-change detection on open positions** — periodic re-simulation
  via deployed HoneypotChecker to catch deployer-flipping-tax
  mid-position. Reuses Phase 18 infrastructure. ANTIRUG-V2-03 in v6.18+.
- **Bytecode static analysis advanced patterns** — `transferFrom`
  selector substitution, modifier-pattern detection, owner-blacklist-self
  detection (multi-address simulation). HONEY-12 minimal selector scan
  ships; richer pattern analysis deferred to v6.18+.
- **Multi-amount tax probe at >100% of snipe size** — discussed as
  potential 4th probe point ("what happens if we tried 2× our snipe");
  rejected because (a) test trade amounts above snipe size give no
  information beyond what 100% gives, (b) larger probe amounts can
  themselves trigger amount-tiered taxes that aren't relevant to our
  actual buy size.
- **Dashboard surfacing of new evidence fields** — buy/sell tax bps,
  bytecode selector hits, probe-by-probe results. Deferred to Phase 21
  EXIT-LIVE or v6.18 dashboard pass. Phase 18 emits to pino + Telegram
  per D-ALERTS but does not extend the dashboard schema.

</deferred>

---

*Phase: 18-honeypot-detection-rebuild*
*Context gathered: 2026-05-15*
