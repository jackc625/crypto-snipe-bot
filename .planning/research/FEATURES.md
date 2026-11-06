# Feature Research — v7.0 Full Audit & Modernization

**Domain:** Adversarial audit and deep modernization of a live-proven TypeScript / ethers v6 EVM MEV sniper bot (Uniswap V2/V3, Flashbots, SQLite, Express 5 + React dashboard, Telegram alpha listener)
**Researched:** 2026-11-06
**Confidence:** HIGH for the codebase-grounded checklist (read directly from `src/` at `c110201`). MEDIUM for incident history and tooling claims (several independent sources or official docs, not re-verified against the latest releases; STACK.md owns version pinning).

> **What "feature" means here.** This milestone adds no trading features. Its "features" are the **deliverables** an audit and modernization of a money-handling bot has to produce. They are grouped under the downstream requirement categories: **Audit, Restructure, Quality, Bugs, Upgrades, Tests, CI, Dashboard, Hygiene, Docs, Live re-proof**.
>
> **Status of the seed findings.** Section 2 lists **candidates** with file:line references I read myself. None has been confirmed by a reproduction yet. Under the project's "don't dismiss anomalies" and D-STOP-THE-LINE rules, each one has to be either confirmed with a RED real-path test or closed as NOT-A-BUG with evidence. None can be waved through.

---

## 1. Feature Landscape

### Table Stakes (a cleanup of a money bot is not credible without these)

| # | Deliverable | Category | Why Expected | Complexity | Depends on / Notes |
|---|-------------|----------|--------------|------------|--------------------|
| T1 | **Findings register** (`AUDIT-FINDINGS.md`): one row per finding with severity, capital-impact class, evidence, disposition and lifecycle status (schema in §2.1) | Audit | Without one canonical list, fixes get done inline or deferred silently, which is how the v6.17 bugs slipped through | MEDIUM | Must exist before any code change. Every later fix commit cites a finding ID |
| T2 | **Codebase-specific bug-class sweep** across `src/`, `dashboard/`, `scripts/`, tests and tooling (checklist in §2.2) | Audit | A generic review misses EVM failure modes such as minOut=0, a nonce bypass or a fee-ceiling bypass. Those are exactly the classes that hit this bot | HIGH | `bot.ts`, `exitEngine.ts`, `anti-rug/detector.ts`, `utils/mevStrategies/*`, `utils/txManager.ts`, `utils/db.ts`, `riskManager.ts`, `api/*`, `telegramListener.ts` |
| T3 | **Operator-decision log** (`OPERATOR-DECISIONS.md`): every behavior-changing recommendation written up as a decision card (format in §3.1) | Audit | The milestone contract says trading behavior never changes silently inside a refactor | LOW | Fed by T1/T2 and the design review (§3). Blocks any fix that changes behavior |
| T4 | **Thresholds and magic-numbers inventory**: every trading constant with its value, source (env or hardcoded), readers and rationale (§3.2) | Audit | A design review can't question thresholds that nobody has listed. Today they are spread across `config.ts`, `exitEngine.ts`, `riskManager.ts` and `api/routes/*` | LOW | Feeds T3. Also feeds the single validated config surface (Q5) |
| T5 | **Characterization (golden-master) tests** that lock current behavior before any move (§4.2) | Tests / Restructure | A deep restructure of files over 2,000 lines without a behavior net is the main way this milestone could lose money | HIGH | Must land before R1. Snapshots get updated only in a commit that cites a finding or decision ID |
| T6 | **Capital-safety fixes, each with a RED-then-GREEN real-path test**, under D-STOP-THE-LINE (never auto-deferred) | Bugs | This is the project's Core Value, and the v6.17 lesson is that a green suite is not evidence | MEDIUM–HIGH per item | Depends on T1 and T3 (if the fix changes behavior) and on the real-path harness (X1) |
| T7 | **Deep restructure**: split `bot.ts` (2,361), `detector.ts` (2,295) and `exitEngine.ts` (2,045); organize by domain (`detection/`, `safety/`, `execution/`, `exit/`, `anti-rug/`, `api/`, `config/`, `persistence/`); dissolve `utils/` | Restructure | This is the operator's stated goal, and oversized files hide duplicated poll loops and an inlined V3 arm path that drifts from the shared one | HIGH | Depends on T5. Moves go in commits separate from fixes (anti-feature A6) |
| T8 | **Zero ESLint errors under type-checked rules** (baseline 350), with no `eslint-disable` and no `as any` used to reach zero | Quality | This is the done bar. 26 floating and 16 misused promises are latent crash or race bugs, not style issues | HIGH | Each `no-floating-promises` / `no-misused-promises` / `prefer-nullish-coalescing` hit in a money path is triaged as a finding (T1) before it is fixed |
| T9 | **Formatter added and the whole repo formatted in one isolated commit**, listed in `.git-blame-ignore-revs` | Quality | Format drift is a CI gate in the done bar. A single commit keeps `git blame` usable | LOW | Do this before T7 so moved code is already formatted |
| T10 | **Dead-code elimination** (knip) with entry points configured for `src/bot.ts`, `scripts/*.ts`, `dashboard/` and test helpers | Quality / Hygiene | Dangerous legacy single-chain code is still present (`simulateSell` sends a real approve, the unused `maybeApproveForChain`, legacy `CONFIG` router addresses) | MEDIUM | Each deletion of dead code that signs transactions is a finding. Verify there are no dynamic or script callers |
| T11 | **All dependencies on latest majors, zero prod `npm audit` vulns, no `--legacy-peer-deps`, `ts-node` replaced** | Upgrades | Operator decision, plus 11 prod vulns including a critical in `proxy-addr` | HIGH | Characterization net (T5) first. One major per commit. See STACK.md for compatibility |
| T12 | **Rewrite of tests that mock the mechanism under test into real-path tests**, and pruning of source-text tests | Tests | The retrospective lesson: CR-01, S-1 and INT-NONCE-SELL all passed a green suite | HIGH | The detection method in §4.1 produces the worklist |
| T13 | **Money-path coverage floor**: per-glob thresholds on buy, exit, anti-rug, nonce and fee code, enforced in CI (§4.4) | Tests / CI | Part of the done bar | MEDIUM | Set from the post-T12 measurement and ratchet-only. Not a global % |
| T14 | **Strict CI gate set**: lint, format, `tsc` for all projects, unit and integration tests, coverage floor, prod audit, `npm ci` with no peer-dep override. Zero baseline, no allowlists (§6) | CI | Part of the done bar | MEDIUM | Each gate is turned on once its category reaches zero. Gates are never turned on with an exception list |
| T15 | **Dashboard / API audit**: auth, CORS, emergency-sell idempotency, input validation (§2.2 J) | Dashboard | The emergency sell is a money-moving endpoint on a local web server | MEDIUM | Part of T2 |
| T16 | **Scripts and contracts tooling audit and Hardhat 3 migration** (tooling only; contract source frozen) | Upgrades / Hygiene | Signing scripts (`recover-sell-ladys.ts`, `deliberate-buy.ts`) bypass the bot's nonce authority and kill-switch | MEDIUM–HIGH | The checker ABI and artifact the bot consumes must stay byte-identical (D3) |
| T17 | **Repo hygiene**: untrack `.DS_Store` and `.idea/`; fix `package.json` (`main: dist/index.js` points to a file that doesn't exist, `version 1.0.0`); add `engines`, `.nvmrc` and `packageManager` | Hygiene | Called out in the milestone baseline | LOW | Independent; good first-phase filler |
| T18 | **Architecture doc and module map** (post-restructure) plus a **cold-start README** | Docs | Part of the done bar | MEDIUM | Depends on T7 |
| T19 | **Runbook refresh**: start, stop, preflight, pause and resume commands change when `ts-node` is replaced | Docs | Ops commands that are stale are a live-money hazard on re-entry | LOW | Depends on T11 |
| T20 | **Re-entry gate**: fork rehearsal, then one small real-capital ETH buy→monitor→sell with on-chain artifacts (D-EVIDENCE-BAR) | Live re-proof | The bot stays OFF until this passes | MEDIUM | Last item. Depends on everything that touches money paths |

### Differentiators (raise the confidence bar well above "lint-clean and green")

| # | Deliverable | Value | Complexity | Notes |
|---|-------------|-------|------------|-------|
| X1 | **Real-path test harness**: real ethers v6 plus a fake at the JSON-RPC transport boundary (or a local anvil/Hardhat node), real SQLite in-memory. Only logger, notifier, broadcaster, relay HTTP and the clock are mocked | Makes "mock only the I/O boundary, never the mechanism" mechanically possible. Today 30 test files run `vi.mock('ethers')` wholesale | HIGH | Prerequisite for T6/T12 at scale. Calldata-argument bugs (e.g. which slot holds minOut) become visible |
| X2 | **Mutation testing (StrykerJS) scoped to money-math and money-decision modules**, with a `break` threshold (§4.3) | Shows which tests actually constrain behavior. A surviving mutant in `computePublicMinOut` or the fee clamp is a test-quality finding | MEDIUM | Nightly or at phase gates, `--incremental`. Not per-PR (too slow) |
| X3 | **Property-based tests (fast-check)** for BigInt math and async interleavings (§4.3) | Invariants such as "minOut ≤ quote", "maxFeePerGas ≤ ceiling for all fee data" and "no two signing ops overlap per wallet" get checked across thousands of inputs, not 3 hand-picked ones | MEDIUM | `fc.bigInt` for amounts, `fc.scheduler()` for race tests of `withNonceLock` and the sell-lock |
| X4 | **Structural signing-authority enforcement**: the `Wallet` is held only by `execution/signer`, whose public API is nonce-locked. Every other module gets a read-only provider. Enforced by a dependency-cruiser rule | Makes the INT-NONCE-SELL class impossible to write, instead of relying on someone noticing that "each site is individually wrapped" | MEDIUM | Today `new Contract(..., ctx.wallet)` appears across `bot.ts`, `exitEngine.ts` and `tokenSafety.ts`. Pairs with T7 |
| X5 | **Architecture boundary rules (dependency-cruiser)**: no cycles; `api/` → service facades only; nothing imports legacy `CONFIG`; `persistence/` is the only importer of `better-sqlite3` | Stops the restructure from decaying back into a grab-bag | LOW–MEDIUM | Runs as a CI gate (zero violations) |
| X6 | **Type-coverage gate** (`type-coverage --strict`, at-least ≥ 99%) | Shows the remaining `any` explicitly; ESLint alone misses `any` that arrives through untyped ethers `Contract` results | LOW | Typed contract bindings (TypeChain is already a dev dep, or ABI-typed helpers) remove most of the 102 `no-unsafe-assignment` hits at the source |
| X7 | **Typed contract bindings for all routers, quoters, pairs and ERC-20** | Removes the root cause of the `no-unsafe-*` errors and catches argument-order mistakes at compile time | MEDIUM | Prefer generating from the ABIs in `utils/abis.ts` over hand-casting |
| X8 | **Single schema-validated config** (all env parsed once at boot; NaN, negative or out-of-range values fail fast; one exported frozen object) | Fixes the NaN-disables-the-limit class (§2.2 A4) and removes 3+ duplicated parsers and 3 duplicated risk-default readers | MEDIUM | Behavior change if any default changes, so it needs a decision card |
| X9 | **Log `op`-taxonomy contract test**: every money-path log call carries a dotted `op`, and the runbook's grep targets exist in code | The `op` names are an operator interface used by the runbook and live captures, and they must survive the restructure | LOW | Part of the characterization set |
| X10 | **ADRs backfilled from comment archaeology**: D-NONCE-AUTHORITY-ALL, D-BALANCE-IS-TRUTH, D-SNIPE-FAIL-CLEAN, D-EVIDENCE-BAR and others become `docs/adr/NNNN-*.md`; phase-ID narrative comments are replaced by one-line ADR references | Code like `bot.ts` is now mostly decision history in comments (e.g. lines 1086–1186). ADRs keep the rationale and make the code readable | MEDIUM | Do this during T7 splits. Never delete a rationale without moving it to an ADR first |
| X11 | **Supply-chain hardening**: Renovate with a minimum release age and grouped, reviewed majors; `npm audit signatures`; GitHub Actions pinned by SHA; `permissions:` least-privilege; gitleaks over the full history plus per-PR | npm saw large maintainer-account compromises in 2025 (e.g. the September 2025 `chalk`/`debug` hijack and the "Shai-Hulud" worm). A bot holding a hot key is a prime target | LOW–MEDIUM | Confidence MEDIUM on incident specifics; the practice is standard |
| X12 | **Write-ahead trade intent and boot-time on-chain reconciliation** (proposed, needs a decision card) | Closes the crash window between "buy hash returned" and "trade row written" (§2.2 E3) | MEDIUM | Behavior and schema change, so it is an operator decision. DB `user_version` goes 7 → 8 |
| X13 | **Deployed-bytecode equivalence check** for `HoneypotChecker` after the Hardhat 3 migration (the compiled artifact matches on-chain `0x8243dBeA…13eD` runtime code, modulo metadata) | Proves the tooling migration didn't silently change the ABI or artifact the bot uses | LOW | Contract source stays frozen, so this only verifies the tooling |
| X14 | **Chaos/fault-injection integration tests** at the boundary: RPC throws on `balanceOf` after a landed buy, WS half-open, relay timeout, SQLite `SQLITE_BUSY` | These are the exact conditions under which the seed findings E2, E4 and F3 strand positions | MEDIUM | Builds on X1 |

### Anti-Features (look like cleanup, add risk or noise)

| # | Anti-Feature | Why Requested | Why Problematic | Alternative |
|---|--------------|---------------|-----------------|-------------|
| A1 | **Big-bang rewrite** of `bot.ts`/`exitEngine.ts` "since we're splitting anyway" | Feels faster than incremental moves | Throws away 2 milestones of live-proven fixes (21.1/21.2/21.3), and every subtle invariant (balance-is-truth, private-only snipes) has to be rediscovered | Mechanical extract-function/extract-module moves under characterization tests. Behavior changes only through decision cards |
| A2 | **Swapping ethers v6 for viem** mid-cleanup | viem is "more modern" and better typed | Touches every money path at once, invalidates the live proof and the Flashbots provider integration (`@flashbots/ethers-provider-bundle` is ethers-based) | Stay on ethers v6 (latest minor). Get the typing benefit from typed bindings (X7). Revisit in a separate milestone if ever |
| A3 | **Chasing 100% coverage / a global coverage %** | Looks rigorous | Produces assertion-free or mock-heavy tests, the exact pattern that hid capital bugs | Per-glob money-path floors (T13) plus mutation score (X2) |
| A4 | **`eslint --fix` / codemods applied unreviewed to money paths** | Fastest path to 350 → 0 | `prefer-nullish-coalescing` autofix turns `CONFIG.slippagePercent \|\| 5` into `?? 5`, which **changes behavior when the value is 0**. Removing "unnecessary" conditions or type assertions can remove guards | Autofix only for non-money modules. In money paths, every semantic autofix is reviewed and, if it changes behavior, logged as a finding and decision |
| A5 | **Reaching lint-zero by suppression** (`eslint-disable`, `as any`, `// @ts-expect-error`, `unknown as T`) | Meets the gate | Violates "no allowlists" in spirit and hides the unsafe sites | Fix at the source with typed bindings (X7) and narrowed error types. Ban inline disables via `--report-unused-disable-directives` plus a `noInlineConfig` policy for `src/` |
| A6 | **Mixing bug fixes into move commits** | Saves a commit | Unreviewable diffs. `git log --follow` and blame lose the fix, and a characterization-snapshot change can't be attributed | Separate commits: move (snapshots unchanged) → fix (snapshot change citing the finding ID) |
| A7 | **Adding abstraction layers**: DI container, repository pattern over SQLite, event bus, plugin system, generic "strategy framework" | "Clean architecture" | More indirection on hot paths, more places for nonce and lock discipline to leak, no capital-safety gain | Plain modules with explicit function boundaries. Only the signer seam (X4) and service facades for `api/` |
| A8 | **Adopting a Result/Either library everywhere** (neverthrow, fp-ts) | Consistent error handling | Repo-wide churn. Mixed throw/Result styles during the transition are worse than either one | Keep the existing discriminated-union outcome pattern (`HoneypotResult`, reconcile `outcome`) at money-path seams, with a small typed error taxonomy. Throw elsewhere |
| A9 | **Switching storage** (ORM, Postgres, Drizzle/Prisma) | "Production-grade" | Out of scope. SQLite WAL is a validated decision, and an ORM adds an async and transaction-semantics change on the money path | Keep `better-sqlite3` (upgrade the major). Fix transaction boundaries and durability (G1–G4) |
| A10 | **ESM migration bundled with TS 7, the restructure and all majors** | Some latest majors are ESM-only (e.g. chai ≥ 5) | Module-resolution changes on top of a restructure multiply the failure modes | Do it only if a required dependency forces it, and isolate it as its own step with the characterization suite green before and after (STACK.md decides) |
| A11 | **Upgrading all dependencies in one commit / one PR** | One install | When anything breaks, nobody can tell which dependency caused it | One major per commit (or a tight group such as Hardhat 3 plus its plugins), full suite after each |
| A12 | **Quietly "fixing" thresholds during a refactor** (e.g. tightening slippage, changing poll intervals) | "Obviously better" | A silent trading-behavior change breaks the milestone contract | Decision card (T3), its own commit, and a snapshot update citing the OD-ID |
| A13 | **New trading capability "while we're in there"**: mempool sniping (DETECT-01), dynamic allocation (CHAIN-05), multi-chain deploy (HONEY-04) | Momentum | Explicitly out of scope, and it mixes new risk into a stabilization milestone | Capture to backlog |
| A14 | **Booting `src/bot.ts` to "smoke test" a refactor** | Quick confidence | There is no dry-run mode. Booting with a funded key can trade | `npm run preflight` (read-only) plus fork rehearsal only |
| A15 | **Replacing `withNonceLock` with ethers `NonceManager`** or adding auto public fallback for snipes | "Simplification" | Both are explicitly rejected decisions (NonceManager fights re-fetch-`latest`, and a public snipe loses its front-run protection) | Keep them, and make them structural (X4) |
| A16 | **Deleting failing tests to get green on new majors** | Unblocks an upgrade | Destroys the regression net exactly when it matters | A failing test after an upgrade is either a real break (fix) or a test bound to implementation details (rewrite as a real-path test), and every deletion is justified in the commit message |
| A17 | **Rewriting the dashboard in a new framework** | Modernization | No capital value; large diff | Upgrade Vite/React/Tailwind majors in place, audit the auth and emergency-sell flows |

---

## 2. Audit Deliverables

### 2.1 Findings register schema (T1)

One markdown table, or one YAML block per finding, in `.planning/AUDIT-FINDINGS.md`. Fields:

| Field | Values / Content |
|-------|------------------|
| `id` | `AUD-<area>-NN`, e.g. `AUD-EXIT-07`. Areas: DET, SAFE, EXEC, NONCE, EXIT, ANTIRUG, DB, RISK, API, TG, CFG, SCRIPT, TOOL, TEST, DASH |
| `title` | One line, states the defect, not the fix |
| `severity` | **S0 Critical**: loss or stranding of funds reachable in normal operation. **S1 High**: loss or stranding under a plausible adverse condition (RPC error, crash, reorg, relay timeout, misconfig). **S2 Medium**: wrong accounting or risk-gate input, or a protection weakened with a compensating control. **S3 Low**: robustness or observability. **S4 Info/Design**: questionable design with no current defect |
| `capital_impact` | `LOSS` (funds leave unrecoverably), `STRAND` (held position with no exit or anti-rug coverage, or unsellable), `OVERSPEND` (gas, fee or slippage beyond the ceiling), `ACCOUNTING` (DB, P&L or risk inputs wrong, so later decisions are wrong), `EXPOSURE` (untrusted input reaches the signing path), `OPPORTUNITY` (missed snipes), `NONE` |
| `likelihood` | High / Medium / Low, plus the triggering condition in words |
| `location` | `file:line@<sha>` (one or more). After the restructure, also the new path |
| `evidence` | Reproduction: a RED test name (real-path), fork script, log excerpt or on-chain tx. "Code reading only" is allowed only while status = `candidate` |
| `class` | Bug-class tag from §2.2 (e.g. `B1-minout-zero`) |
| `behavior_change` | yes/no. If yes, it must link an `OD-NN` decision card |
| `disposition` | `FIX-STOP-THE-LINE` (S0/S1 capital, fixed before anything else in its area) · `FIX-IN-PHASE` · `OPERATOR-DECISION` · `ACCEPTED` (operator-signed rationale; **not allowed for S0/S1 with capital impact other than NONE/OPPORTUNITY**) · `NOT-A-BUG` (with evidence) · `DUPLICATE-OF` · `DEFERRED-FAIL-CLOSED` (only if the deferred state refuses to act, the HONEY-04 precedent; fail-open deferral is never allowed) |
| `status` | `candidate → confirmed → decided → fixed → verified`. `verified` means an independent reviewer has re-run the RED→GREEN proof |
| `fix_ref` | Commit SHA(s), test IDs, snapshot updates |

Reference practice: professional smart-contract audit reports (Trail of Bits, OpenZeppelin, Spearbit) separate **severity** from **difficulty/likelihood** and track a **fix-review status** per finding. The register above follows that structure, adapted to off-chain trading capital. (MEDIUM: from general knowledge of public reports, not re-fetched.)

### 2.2 Codebase-grounded audit checklist (T2)

Each class lists the **seed candidates** found while skimming, which are starting points, not the full sweep. Incident references show why the class matters for bots specifically.

#### A. Numeric precision, BigInt/Number mixing, falsy defaults

| Seed | Location | Candidate defect | Sev (provisional) |
|------|----------|------------------|-------------------|
| A1 | `exitEngine.ts:315-345` `queryPrice` | Returns `Number(amountOut)`, so all exit decisions run in float. Precision loss is negligible for ratios, but **entryPrice = 0** makes `priceMultiple = Infinity` or `NaN` (`exitEngine.ts:1714`), and every comparison with NaN is false, so the trailing and stop-loss checks never fire | S1 STRAND |
| A2 | `exitEngine.ts:1708,1869` | The price probe uses `buyAmountWei` (the ETH-wei size of the buy) as the **token** `amountIn`. The probe is decimals-blind: for 6- or 9-decimal tokens it is a huge sell that may exceed reserves (the quote reverts, returns null, and the cycle is skipped indefinitely), and for very high-supply tokens it is dust (quote = 0, so A1) | S1 STRAND |
| A3 | `bot.ts:1050-1053`, `bot.ts:1373-1374` | `BigInt(slippage)` throws `RangeError` for fractional percentages, the catch sets `minOut = 0n`, and the buy goes ahead unprotected. Latent today because `slippagePercent: 5` is hardcoded | S2 (latent S1) |
| A4 | `riskManager.ts:28-31`, `config.ts:300-302`, `api/routes/risk.ts:80-82`, `api/routes/chains.ts:88-90` | `parseInt/parseFloat(env \|\| 'x')` with no NaN guard. `MAX_OPEN_POSITIONS=ten` gives NaN, `open >= NaN` is false, and **the risk limit is disabled (fail-open)**. A bad `TRAILING_STOP_PCT` disables the trailing stop. The same defaults are parsed in 3 places, so the dashboard can show different limits from the ones enforced | S1 EXPOSURE |
| A5 | `bot.ts:529,703,1050,1373`, `exitEngine.ts:470`, `preflight.ts:837-838` | The `\|\| default` falsy class: a configured `0` is silently replaced. Five differently-behaving env parsers (`parsePositiveIntEnv` `n>=0`, `parsePositiveNumberEnv` `n>0`, `parsePositiveIntDefault`, `reconciliation.parsePositiveNumber`, `bot.parsePositiveNumberDefault`) | S3 → feeds X8 |
| A6 | `api/helpers/positions.ts:147,158`, `api/routes/risk.ts:70,107` | P&L and exposure computed in float from string amounts (`parseFloat(trade.buy_cost)`, `currentPrice / 1e18`). Check whether the same float math feeds `riskManager.canSnipe` (accounting drift turning into a wrong gate) | S2 ACCOUNTING |

ESLint hooks: `@typescript-eslint/prefer-nullish-coalescing`, `restrict-plus-operands`, `no-unnecessary-condition`, plus a directory-scoped `no-restricted-syntax` that bans bare `Number(`/`parseFloat(` in `exit/` and `execution/` in favor of one named lossy-conversion helper.

#### B. Slippage, minOut, deadlines

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| B1 | `exitEngine.ts:362-364` (V2), `exitEngine.ts:388-393` (V3) | **Private full and partial sells use `amountOutMin = 0`**. Private relays are not a guarantee: on 2023-04-03 a malicious proposer exploited a mev-boost-relay bug, unbundled sandwich bots' private bundles and took about $20–25M (Flashbots post-mortem; CertiK). Pool state can also move between signing and inclusion during multi-block escalation. Possibly deliberate ("guarantee the exit"), which is why it needs an **OPERATOR-DECISION** card: a bounded minOut from a fresh quote with reason-aware slippage (reusing `computePublicMinOut`) vs. the status quo | S1 LOSS |
| B2 | `exitEngine.ts:363` vs `:553` | The private V2 sell uses `swapExactTokensForETH`, which does not support fee-on-transfer tokens, while the public fallback uses `...SupportingFeeOnTransferTokens`. Taxed tokens that pass the checker's tax probe would revert privately, never be included, burn the attempt budget, and only exit through public | S2 OVERSPEND/STRAND |
| B3 | `bot.ts:1048-1056` (V2), `bot.ts:1365-1377` (V3) | **Buy minOut fails open.** A quote failure is logged as "defaulting to 0" and the **buy still goes out with no slippage bound**. It should fail closed (skip the snipe) | S1 LOSS |
| B4 | `bot.ts:1043` → `submitBuyTx(() => populate…deadline)` | The buy deadline (60 s) is captured **outside** the tx-builder closure, so multi-block private escalation re-signs with a stale deadline and late attempts revert. Exit builders compute it inside the closure (`exitEngine.ts:362`), so the two paths are inconsistent. Magic numbers: 60 s snipe vs 600 s deliberate buy (`bot.ts:731`) vs 600 s public sell (`exitEngine.ts:551`) | S2 OPPORTUNITY/OVERSPEND |
| B5 | `exitEngine.ts:524-560` | Quote, then `approve()` with `wait()` (which can take blocks), then swap with a minOut from the **stale** quote during a liquidity drain. The anti-rug public fallback may revert repeatedly on its own floor | S2 STRAND |

Incident class: **Salmonella** (March 2021) delivered 10% of the tokens while emitting full-amount `Transfer` events, trapping bots that trusted logs or quotes. Lesson: verify by balance delta. `receiptDecoder.ts` correctly filters logs by the WETH address (`:75,91`); keep that and add a balance-delta cross-check on the token side.

#### C. Approvals and allowance

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| C1 | `exitEngine.ts:413-424` `ensureApproval`, `:541-546` | Approval txs go out through ethers defaults, **outside the MEV strategy's fee-ceiling clamp** (the same class as the CR-01 fee-ceiling bypass) and **to the public mempool**, which reveals sell intent on a rugging token before the private sell. An exact-amount approval per (partial) sell adds one signed tx and one nonce-lock hold each time | S2 OVERSPEND/EXPOSURE |
| C2 | `tokenSafety.ts:269-300` `simulateSell`, still imported at `bot.ts:17` | A "simulation" that sends a **real signed `approve`** against legacy `CONFIG.routerAddress`. Apparently dead, but it is the same hazard class as the deleted `hasHighTransferTax` (D-DELETE-LEGACY) | S2 → delete |
| C3 | `bot.ts:222-229` `maybeApproveForChain` | Unused, and does not `.wait()` the approve. Dead | S4 → delete |
| C4 | all approvals | Maestro (2023-10-24, about 280 ETH) and Unibot (2023-10-31, about $640k) were drained through **standing approvals to routers with unchecked arbitrary-call paths** (CertiK). Verify that spender addresses come only from the hardcoded `chainRegistry` (never env or Telegram-injectable), that no approval is infinite, and that no non-canonical router is ever approved | S3 check |

#### D. Nonce and signing authority

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| D1 | `utils/nonceAuthority.ts:61-75` | `withNonceLock` is **not reentrant**: a nested acquisition for the same wallet deadlocks permanently, and there is **no timeout**. Audit all 36 call sites for nesting through helpers, and check that `exitWatchdog.ts` covers a wedged lock holder | S1 STRAND |
| D2 | same | **Head-of-line blocking**: an anti-rug emergency sell queues behind an in-flight multi-block private buy escalation holding the wallet lock. There is no priority lane, so this needs an **OPERATOR-DECISION** (priority queue or abortable buy escalation) | S1 STRAND |
| D3 | `bot.ts:1045`, `exitEngine.ts:524`, `tokenSafety.ts:274` | `new Contract(addr, abi, ctx.wallet)` is scattered across the code, so lock coverage depends on discipline. Proof that "every site is wrapped" has to be **structural** (X4), not a list | S2 → X4 |
| D4 | `scripts/recover-sell-ladys.ts`, `scripts/deliberate-buy.ts` | Out-of-process signers share the wallet but not the lock or kill-switch. If the bot runs concurrently, nonces collide. Add a PID or lockfile guard, or route through the same authority | S2 |

#### E. Inclusion, receipts, crash consistency, reorgs

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| E2 | `bot.ts:1086-1191` | **A post-submit exception marks a LANDED buy as failed.** One `try/catch` wraps both `submitBuyTx` and the post-submit bookkeeping (`insertTrade`, alert, `balanceOf`, `getTradeIdForPendingToken`, `armPositionMonitoring`). If `balanceOf` hits an RPC error after inclusion, the catch runs `emitSnipeFailClean`, `updateTradeStatus('failed')` and the alert "TX failed", and **the position is held with no exit monitor and no anti-rug**. The in-code invariant ("throw means zero ETH spent") holds only for throws from `submitBuyTx`. Same shape in the V3 handler (`bot.ts:1431-1514`) | **S0/S1 STRAND (verify first)** |
| E1 | `bot.ts:1150-1151` | `originalTokenAmount = balanceOf` read immediately after the hash returns, possibly from a different RPC node than the one that saw inclusion. It can read 0 or stale, which makes the dust threshold fall back to its 1000-wei floor (`exitEngine.ts:605-611`) and makes partial-sell tiers compute from 0 | S1 STRAND |
| E3 | `bot.ts:1100` → `:1127`; `db.ts:22` | **Crash window**: if the process dies between hash return and `insertTrade`, the held position has no row and the boot-time resume never sees it. Separately, `synchronous = NORMAL` under WAL can lose the last commits on OS crash or power loss (not on an app crash). Candidate fix X12 (intent row plus boot reconciliation), with `synchronous=FULL` as an **OPERATOR-DECISION** (the write rate is tiny, so the cost is negligible) | S1 STRAND |
| E4 | `exitEngine.ts:1869-1873` | If the initial `queryPrice` returns null, `startExitMonitor` **logs and returns**, so the position is held with no routine exit monitor and no retry (combines with A2). Should retry with backoff or fail loud with a hard alert | S1 STRAND |
| E5 | `bot.ts:1636-1680` (HTTP poll at head), anti-rug backfill | No reorg handling: events are processed at head with `lastBlock = currentBlock`. Rare on PoS ETH (1-block reorgs), but list it: a reorged-out `PairCreated` leads to a buy into a non-existent pool (it reverts, wasting gas), and a reorged sell receipt gives a wrong `amount_out` | S3 |
| E6 | every `.wait()` site | ethers v6 `wait()` **throws** `CALL_EXCEPTION` on status 0 and throws `TRANSACTION_REPLACED` with `reason` `repriced`/`replaced`/`cancelled` on nonce reuse. A `repriced` outcome means the tx **succeeded** under a new hash. Check every consumer (e.g. `exitEngine.ts:545,556`) for correct classification | S2 |

#### F. Async correctness, the event loop and timers

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| F1 | `bot.ts:1582-1584` (V2 listener), the V3 listener, `bot.ts:1644,1669` (HTTP poll) | `handleNewPairForChain(...)` is **not awaited and not caught**, and there is **no `process.on('unhandledRejection')` anywhere in `src/`**. Node's default since v15 is to crash on an unhandled rejection, so one throw outside the handler's inner try (e.g. in the safety bank or `getPauseState`) **takes down exit monitors and anti-rug for every position**. Needs an **OPERATOR-DECISION** on the policy: crash fast under a supervisor with resume, or contain per handler. Recommendation: contain per handler, plus a global handler that hard-alerts and triggers a controlled restart | S1 STRAND |
| F2 | `exitEngine.ts:1906`, `:2007`; `bot.ts:1636,1660,1740,1774`; `detector.ts:1261`; `api/server.ts:186` | **`setInterval(async …)` overlap.** When `pollExitStrategy` exceeds 5 s under RPC lag, cycles run concurrently and mutate the same `state` (high-water mark, duplicate volatility samples, interleaved `upsertExitState`). The HTTP poll (2 s) can read the same `lastBlock` twice and process events twice. Fix pattern: self-scheduling `setTimeout` or an in-flight guard. The two poll-loop bodies (start vs resume) are also near-duplicates, which invites drift | S2 |
| F3 | `bot.ts:1549-1618` | **WS reconnect.** Each DEX registers its own `'close'` handler on the shared chain WS, so with N DEXes, N reconnect loops race and each assigns `ctx.wsProvider` (last write wins; orphaned providers leak and may keep emitting). The old provider is never `destroy()`ed. `(ws.websocket as any)` is untyped. There is **no `PairCreated` backfill** for the disconnected gap (anti-rug has one; detection doesn't). There is **no heartbeat** on the detection WS, so a half-open socket dies silently without a `close`. The infinite `while(true)` loop ignores shutdown | S2 OPPORTUNITY (S1 if `ctx.wsProvider` reassignment breaks anti-rug's consumer, so verify) |
| F4 | `bot.ts:881`, `:1211` | **Dedup TOCTOU**: `isTokenSniped` is a DB check, but the row is written only **after** submit, many awaits later. Two events for the same token (WS plus HTTP overlap, V2 and V3 pools for one token, or Telegram plus factory event) can both pass the check, giving a **double buy**. Needs a synchronous in-memory in-flight set keyed `chain:token` | S1 LOSS/OVERSPEND |
| F5 | reconnect loops, `setTimeout` sleeps | Timers aren't registered for two-stage SIGINT teardown. Verify that every timer is either cleared at shutdown or `unref()`ed | S3 |

All 26 `no-floating-promises` and 16 `no-misused-promises` lint hits get triaged into this class as findings. They are not lint chores.

#### G. SQLite transaction boundaries and durability

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| G1 | `bot.ts:1127` → `:1154` | `insertTrade` followed by **`getTradeIdForPendingToken(token, chain)` lookup** instead of `run().lastInsertRowid`. It is ambiguous if a stale pending row exists for the token. Multi-statement state transitions (trade plus exit_state, failed-held stamping) should be in `db.transaction()` | S2 ACCOUNTING |
| G2 | `utils/db.ts` top level | The DB opens at **import time** with `DB_PATH` read from the environment at import time, so import order matters for tests and scripts. The restructure should move this to explicit `openDb()` in `persistence/` | S3 |
| G3 | `db.ts:22` | `synchronous = NORMAL` (see E3) | S2 |
| G4 | migrations (`user_version` 7) | DDL already runs in transactions (good). Add a schema-dump characterization snapshot and a pre-migration backup step | S4 |

#### H. Gas and fee ceilings

| Seed | Location | Candidate defect | Sev |
|------|----------|------------------|-----|
| H1 | `mevStrategies/flashbots.ts:167-171`, `passthrough.ts:63-65` | `baseFeeWei = maxFeePerGas − maxPriorityFeePerGas`. In ethers v6 `getFeeData()`, `maxFeePerGas` is roughly `2×baseFee + priority`, so this "base fee" is **about 2× the real one**. Verify whether the affordability and ceiling math treats it as the real base fee (over-reserving, and refusing at half the intended level) or as deliberate headroom (then rename it) | S2 (verify) |
| H2 | approvals (C1) | Approvals bypass the clamp | S2 |
| H3 | `gasManager.ts:39-48` `getGasOptions` | Legacy `CONFIG` fixed 300k path, likely dead (knip) | S4 |
| H4 | `chain.gas.maxGasLimit` | A fixed gas limit on sells. Tokens with heavy transfer hooks run out of gas, a known honeypot-family trick. Check that the checker's roundtrip gas is compared with the configured limit | S3 |

#### I. Secrets, configuration and env validation

- **I1** `config.ts:271`: `CONFIG.walletPrivateKey` holds the raw key on a module-level object. Verify pino `redact` paths cover `privateKey`, `*.authKey`, `TELEGRAM_SESSION` and `DASHBOARD_API_KEY`, and that no log line ever serializes `CONFIG` or `ctx`. `TELEGRAM_SESSION` is a **full account-takeover credential**; document it as such. (S2)
- **I2** `config.ts:265-310`: legacy `CONFIG` with hardcoded mainnet router, factory and WETH plus `NETWORK` defaulting to `'sepolia'` coexists with `chainRegistry` (`ENABLED_CHAINS` default `'eth'`). Two sources of truth for chain addresses, and `process.env.ALCHEMY_URL!` non-null assertions. (S3, removed by X8)
- **I3** `REQUIRED_ENV_VARS` checks presence, not type or range (A4). (S1 through A4)

#### J. API and dashboard (Express 5, local, with emergency sell)

- **J1** `api/server.ts:97-140`: the same-origin check derives the request origin from the `Host` header, so a DNS-rebinding page is treated as same-origin. Mitigated because `/api` requires a session cookie (`server.ts:162`) that the attacker cannot get. Add a `Host` allowlist (`127.0.0.1:<port>`, `localhost:<port>`, plus configured origins) as defense in depth. (S3)
- **J2** `api/middleware/auth.ts`: no login rate limiting or lockout, the length check before `timingSafeEqual` leaks key length, there is no logout or revocation, sessions live in memory, and `secure` is only set when `NODE_ENV=production`. (S3)
- **J3** `api/routes/controls.ts:121-222`: `POST /emergency-sell` runs a sequential sell of every position **inside the HTTP request**. A client timeout or retry gives a second concurrent run, which relies only on per-token sell locks. Add an idempotency key or job model (`202` plus a status endpoint), and audit that force-sell validates the trade state. (S2)
- **J4** Attacker-controlled token `symbol`/`name` flows into Telegram Markdown (`bot.ts:1145` `` `${symbol}` ``) and the dashboard. `sanitizeReason` covers reasons, not symbols. Check for markdown injection and confirm there is no `dangerouslySetInnerHTML`. (S3)
- **J5** Phase-20 WR-01/WR-02 carry-overs (scheme-blind CORS, 500 instead of 403) need re-verification. (S3)

#### K. Telegram alpha listener trust

- **K1** `telegramListener.ts:74-79` (**strong candidate**): the whitelist is `senderAllowed OR channelAllowed`, and an **empty set means allow-all**. Configuring only `TELEGRAM_ALLOWED_SENDERS` leaves `channelAllowed = true` for every message, so **the sender whitelist has no effect**. With both empty (the default, WR-09), **any message visible to the account** (spam DMs, any joined group) feeds addresses into the buy pipeline. Banana Gun (2024-09-19, about $3M, 11 users) was a flaw in its Telegram-message-to-signed-action oracle, the same trust boundary. The fix (fail-closed default, explicit AND/OR semantics) changes behavior, so it is an **OPERATOR-DECISION**. (S1 EXPOSURE)
- **K2** The regex extracts any `0x…40-hex`, and `getCode != '0x'` only filters out EOAs, so routers, WETH or stablecoins in a message enter the pipeline. Check that `BLOCKLIST` covers canonical tokens. The global `COOLDOWN_MS` silently drops valid addresses, and `processedContracts` is an unbounded Set. (S3)

#### L. Anti-rug

- **L1** `anti-rug/detector.ts` (2,295 lines): the **7-day dry-run default** is a time-based behavior flip. After 5 months off, is dry-run measured from a persisted timestamp (so it would arm immediately on restart) or from boot? Confirm and log it as an explicit operator decision for re-entry. (S2)
- **L2** Backfill chunking against provider `getLogs` caps, the heartbeat and polling fallback, circuit-breaker reset semantics, and whether any sell path bypasses the nonce authority. (Sweep)

#### M. Process lifecycle

- Two-stage SIGINT under the `ts-node` replacement (signals behave differently under `node dist/` vs `npx`), the policy for unhandled rejections and uncaught exceptions (F1), supervisor restart, and boot-time resume (`getResumeExitMonitorTrades`) as the recovery path. Capture these in the runbook (T19).

### 2.3 Audit procedure

1. Run the sweep **read-only**, area by area, recording every observation as `candidate`.
2. Confirm each capital-impact candidate with a **RED real-path test** (X1 harness) or a fork script. Only then does it become `confirmed`.
3. S0/S1 capital findings get `FIX-STOP-THE-LINE` and are fixed before the restructure touches that area.
4. Hand behavior-changing findings to the operator as decision cards (§3.1), batched per area so they don't trickle in one at a time.
5. An independent reviewer re-runs each RED→GREEN proof before `verified` (the gsd-verifier alone is not enough here; see memory "green suite misses money-path bugs").

---

## 3. Design-Review Deliverables

### 3.1 Operator decision card format (T3)

```markdown
### OD-07 — Private sells carry amountOutMin = 0
- Finding: AUD-EXIT-03 (B1)  · Severity S1 · Capital: LOSS
- Current behavior: exitEngine.ts:362-364 / :388-393 — private V2/V3 full & partial
  sells submit with minOut 0; protection relies entirely on bundle privacy.
- Why it matters: relay-unbundling (2023-04-03 mev-boost-relay incident) and
  inter-block pool moves during multi-block escalation; a rugging pool fills at ~0.
- Options:
  A. Keep (status quo) — maximal fill probability; unbounded price.
  B. Bounded minOut from fresh quote × reason-aware slippage (routine 5%, anti-rug
     ≥15%) via computePublicMinOut — same math already live on the public path.
  C. B for routine exits, A for anti-rug only.
- Capital impact each way: A = tail loss on unbundling/adverse move; B = risk of
  non-fill on fast drains (mitigated by existing public fallback ladder).
- Reversibility: env knob? (yes/no) · Snapshot IDs affected: CHAR-EXIT-012..015
- Recommendation: C  · Evidence: fork replay of LADYS + rug fixtures
- Decision: ____  · Date: ____ · Implemented in: <sha>
```

Rules: one card per behavior change. The card is decided **before** its implementing commit. The commit updates only the characterization snapshots listed on the card. Cards that aren't decided by the end of the audit default to **keep current behavior** (the milestone contract), except S0/S1 capital findings, which cannot sit on the default: they block the re-entry gate until decided.

### 3.2 What "questionable design" findings look like

**Thresholds and magic-numbers inventory (seed).** Every entry gets: value, where it is defined, whether it is env-tunable, who reads it, documented rationale (y/n), and a recommendation.

| Constant | Value | Source | Design question |
|----------|-------|--------|-----------------|
| Buy slippage | 5% | `config.ts:282` hardcoded (`\|\| 5` at 4 sites) | Not env-tunable, yet the code reads it as if it were. Fractional values break the BigInt math (A3) |
| Exit poll interval | 5 s | `config.ts:305` hardcoded | Overlap under RPC lag (F2); one interval per position doesn't scale |
| Urgency hard exit | 30 min | `config.ts:306` | Market sell at a fixed age regardless of liquidity; age-weighted urgency |
| Trailing stop | 15% (5–40) | env, no NaN guard | A4 |
| Stop-loss | 25% | env, NaN-guarded | Marked `@deprecated` but still read? |
| Anti-rug public slippage | 15%, floor 10% | `exitEngine.ts:470-477` | Documented. Re-check against rug-fixture fills |
| Private attempt budget | 2 (anti-rug 1) | env | Interplay with the lock HOL (D2) |
| Dust threshold | 1 bps + 1000 wei | `exitEngine.ts:605-611` | Floor-only behavior when `originalTokenAmount = 0` (E1) |
| Routine max failures | 5 | env | Then routine retries pause; anti-rug bypasses |
| Deadlines | 60 s / 600 s / 600 s | `bot.ts:1043,731`, `exitEngine.ts:551` | Inconsistent; stale-deadline capture (B4) |
| HTTP poll | 2 s | `bot.ts:1650` | Overlap (F2); no range cap on `queryFilter` |
| WS backoff | 1 s → 60 s | `bot.ts:1590-1591` | No gap backfill (F3) |
| Risk defaults | max open 10, **exposure 10.0 ETH**, daily loss 10%, cooldown 30 s | `riskManager.ts:28-31` (plus 2 API copies) | Defaults are loose relative to the shipped 0.01-ETH snipe size. Three parse sites (A4) |
| Session TTL | 24 h | `auth.ts:14` | For a key that can trigger an emergency sell |
| Volatility baseline | CV 0.03, 12–60 samples | `config.ts:307-309` | Undocumented rationale |
| Telegram cooldown | `COOLDOWN_MS` | `telegramListener.ts` | Silent drops (K2) |

**Race-window findings** are written as *window, actors, interleaving, consequence, current mitigation, residual*. Example: CP2 pause check → submit (documented WR-01, accepted); `isTokenSniped` → `insertTrade` (F4, **not** mitigated).

**Fragile-pattern findings**: duplicated poll-loop bodies (`exitEngine.ts` start vs resume), the V3 snipe path inlining arm logic instead of `armPositionMonitoring` (known debt), mutable `ctx.wsProvider` shared across modules (F3), module-import side effects (G2), comment-as-history (X10), legacy `CONFIG` coexisting with `chainRegistry` (I2), source-text tests (§4.1).

---

## 4. Test-Suite Quality Deliverables

### 4.1 Detecting "mocks the mechanism under test" systematically (T12)

Baseline signal from the scan: `vi.mock('ethers')` appears in **30** files, and **39** files mock at least one of `nonceAuthority`, `txManager`, `mevStrategies/*`, `reconciliation` or `exitEngine`. Another **30** files read files with `readFileSync`, including source-text assertion tests such as `codeQuality.test.ts`, `ethersV5PatternsAbsent.test.ts` and `ci/rootFileGuard.test.ts`. These break or go vacuous under the restructure.

Procedure (scriptable, and the output becomes the T12 worklist):

1. **Define the mechanism set**: the money-path modules whose logic is the thing at risk (`nonceAuthority`, `txManager`, `mevStrategies/*`, `reconciliation`, the exit sell builders and `computePublicMinOut`, `exitTrigger`, `riskManager.canSnipe`, `receiptDecoder`, the DB write statements, and `ethers` itself, which handles ABI encoding and `Contract` dispatch).
2. **For each test file, extract** (a) the subject (the `src` imports that are *not* mocked) and (b) the `vi.mock` targets.
3. **Flag the file** when a mocked target is in the mechanism set **and** the test is on a money path, or when it asserts only interactions with that mock (`expect(mockX).toHaveBeenCalledWith(...)`) and not observable outcomes (calldata, DB rows, balances).
4. **Treat a wholesale `vi.mock('ethers')` as automatically flagged**: it makes argument-order bugs (e.g. the minOut slot in `encodeFunctionData`) invisible.
5. **Cross-check with mutation testing** (§4.3): surviving mutants in mechanism code point to the tests that don't constrain it.
6. **Rewrite pattern**: real ethers plus a fake JSON-RPC transport (or an anvil fork) plus real in-memory SQLite. Mock only logger, notifier, broadcaster, relay HTTP and the clock (the RETROSPECTIVE rule).
7. **Enforce it going forward**: a CI script fails if any test `vi.mock`s a mechanism-set module. Where a caller test needs isolation, it gets it through an injected boundary fake, not a module mock. That keeps the rule exception-free.
8. **Convert source-text tests** into ESLint rules (`no-restricted-imports`, `no-restricted-syntax`) or dependency-cruiser rules, or delete them when they are redundant with the type system.

### 4.2 Characterization / golden-master set (T5), required before the restructure

Freeze with `vi.useFakeTimers()` plus `vi.setSystemTime()` (deadlines embed `Date.now()`), using file snapshots:

| Set | What is captured | Why |
|-----|------------------|-----|
| CHAR-CALLDATA | Exact `encodeFunctionData` output and tx fields for the V2 buy, V3 multicall buy, private V2/V3 sells, public fallback sell and approvals, from fixed inputs | Catches argument, slot and deadline drift through moves and the ethers upgrade |
| CHAR-EXIT | `pollExitStrategy` action sequence over recorded price series (pump, dump, chop, tier hits, urgency, quote-null) | Locks trailing, partial and urgency semantics |
| CHAR-RISK | `canSnipe` verdicts over DB fixtures | Locks the 5-rule gate |
| CHAR-ANTIRUG | Signal-evaluator verdicts on the existing rug and real-launch log fixtures | Locks the AND-chain |
| CHAR-FEES | Clamp outputs (priority, maxFee, refuse) across a fee-data grid, per strategy | Locks the CR-01 fix |
| CHAR-DB | Schema dump at `user_version=7`, migration from v6 fixtures | Protects persistence through the `better-sqlite3` major |
| CHAR-API | Response shapes for every dashboard route | Protects the dashboard contract |
| CHAR-OPS | Set of `op` values emitted per lifecycle path | Protects runbook and live-capture greps (X9) |

Characterization tests deliberately freeze current behavior, **bugs included**. A snapshot changes only in a commit citing `AUD-…`/`OD-…`.

### 4.3 Stronger-than-coverage signals (X2, X3)

- **StrykerJS** (`@stryker-mutator/vitest-runner`): `mutate` scoped to the money-math and decision modules (Stryker supports globs and line ranges), `thresholds.break` set from the first measured run and ratchet-only, `--incremental` for fast re-runs. Initial targets: break ≥ 80 on pure money math (`computePublicMinOut`, the dust threshold, the fee clamp, env parsers, `canSnipe`) and ≥ 60 on orchestration (exit trigger, reconciliation). Run it nightly or at a phase gate, not on every PR. (MEDIUM: Context7 StrykerJS docs; check the Vitest 5 runner compatibility in STACK.)
- **fast-check properties**:
  - `computePublicMinOut(q, s)`: `0 < minOut ≤ q` when `q > 0`; monotone non-increasing in `s`; never below 1% of `q`.
  - Fee clamp: for all fee data, `maxPriorityFeePerGas ≤ ceiling`, `maxFeePerGas ≤ base + ceiling`, and refusal when the reserve can't cover the exit.
  - Buy minOut: never `0n` for a non-zero quote (fails today through A3/B3, so it is a RED seed).
  - Env parsers: never `NaN`, never negative, never `undefined` on garbage input.
  - `priceMultiple`: finite for all `entryPrice > 0`, and an explicit branch for 0 (A1).
  - `withNonceLock` with `fc.scheduler()`: no two ops for one wallet overlap under any interleaving; a rejected op never poisons the chain; reentrancy is detected (D1).
  - Sell-lock plus in-flight dedup: one sell (or buy) per `chain:token` under any interleaving (F4).

### 4.4 A meaningful coverage floor (T13)

- Use **per-glob thresholds** in the Vitest coverage config on post-restructure paths (MEDIUM: Vitest supports glob-keyed `coverage.thresholds`; verify on v5). Nonce, fee clamp, minOut and env parsing: **branches ≥ 95%**. Exit, anti-rug trigger, risk and execution: **branches ≥ 85%, lines ≥ 90%**. Elsewhere: no floor, or a low global floor (≥ 70% lines) only as a tripwire.
- **Branches, not lines**: the capital bugs live in `catch` and `else` branches (E2, B3, E4).
- Ratchet-only (a CI check that thresholds never decrease). The floor only counts if the tests behind it are real-path, so it is measured **after** the T12 rewrite.

---

## 5. Code-Quality Deliverables

| Deliverable | Target | Notes |
|-------------|--------|-------|
| ESLint `strictTypeChecked` (typescript-eslint flat config) | 0 errors, 0 warnings (`--max-warnings 0`), `--report-unused-disable-directives`, no inline disables in `src/` | Key rules: `no-floating-promises`, `no-misused-promises` (`checksVoidReturn` catches `setInterval(async)` and `.on(..., async)`), `switch-exhaustiveness-check` (for `HoneypotResult` and outcome unions), `prefer-nullish-coalescing` (manual in money paths, A4), `restrict-template-expressions`, `no-unnecessary-condition` |
| Typed contract bindings (X7) | No `any` from `Contract` results | Removes most `no-unsafe-*` at the source |
| type-coverage (X6) | ≥ 99% strict | CI gate |
| knip (T10) | 0 unused files, exports or deps | Entry points: `src/bot.ts`, `src/telegramListener.ts`, `scripts/*.ts`, `hardhat.config.*`, `dashboard/src/main.tsx`, vitest configs |
| dependency-cruiser (X4/X5) | 0 violations | Rules: no cycles; `api/**` → `*/service` only; only `execution/signer` may import `Wallet`/`getWallet`; only `persistence/**` may import `better-sqlite3`; nothing imports legacy `config.ts#CONFIG` |
| Error handling | Discriminated-union outcomes at money seams, plus a small `BotError` taxonomy (`RpcError`, `RelayError`, `RevertError`, `ConfigError`) carrying `op` and context | Not a Result library (A8). The Flashbots "bare string rejection" guard stays centralized in one adapter |
| Structured logging | Every money-path log has a dotted `op`; pino `redact` covers secrets; `info` per-5s-poll logs (`exit.poll.cycle`) reviewed for volume (move to `debug` or sample it) | Changing log levels is behavior-adjacent, so cite a decision for the `op`s the runbook depends on |
| File-size budget | e.g. no `src/` file over 600 lines after the restructure | Lint via `max-lines` (error) |

---

## 6. CI / Ops Deliverables (T14, X11)

**Gate set (all blocking, zero baseline, no allowlists):**

1. `npm ci` with no `--legacy-peer-deps` (lockfile integrity; peer conflicts fixed for real).
2. Format check (`prettier --check` or `biome format`; STACK decides).
3. `eslint . --max-warnings 0`.
4. `tsc --noEmit` for root, dashboard and contracts tooling (existing ×3).
5. Unit and integration tests (existing), plus the per-glob coverage thresholds.
6. `npm audit --omit=dev` at zero (any severity) for root **and** `dashboard/`.
7. knip, dependency-cruiser, type-coverage.
8. Existing guards kept or migrated: `.todo` ban, root-doc ban (converted from source-text tests into scripts or lint rules), contracts-gated hardhat-compile, slither and mythril.
9. gitleaks over PR commits, plus a **one-time full-history scan** (the repo has a long history and handled `.env`-adjacent tooling).
10. Mock-the-mechanism guard script (§4.1 step 7).
11. Not per-PR: Stryker (nightly or at phase gates), and fork tests (`workflow_dispatch`, secret-gated RPC).

**Supply chain**: Renovate with a minimum release age (cooldown) and majors as separate reviewed PRs; `npm audit signatures` in CI; Actions pinned to commit SHAs; top-level `permissions: contents: read`; `engines` plus `.nvmrc` plus `packageManager` for reproducible toolchains.

**Reproducible build and run**: compile to `dist/` with `tsc` (or the STACK-chosen runner) and run `node dist/bot.js`. This replaces `npx ts-node` and also fixes the Windows "npx swallows Ctrl+C" issue. Set `main` correctly, pin solc in the Hardhat 3 config, and run the bytecode equivalence check (X13).

---

## 7. Docs Deliverables

| Doc | Content | Depends on |
|-----|---------|------------|
| `docs/ARCHITECTURE.md` | Domain module map; buy → monitor → exit → anti-rug data flow; the **invariants list** (per-wallet nonce authority, balance-is-truth teardown, snipes private-only, fail-closed chains, kill-switch checkpoints CP1–CP3, D-EVIDENCE-BAR); the dependency rules from X5 | T7 |
| `docs/adr/` | Backfilled ADRs for the key decisions in PROJECT.md and the D-* conventions now living in comments (X10) | During T7 |
| `README.md` | Cold start: prerequisites, env reference (generated from the single config schema, X8), `npm run preflight`, start and stop, pause and resume, where logs and the DB live, "there is no dry-run mode" warning | T11, X8 |
| Runbook (versioned) | Updated commands after the `ts-node` replacement, unhandled-rejection and restart policy (F1), re-entry checklist (T20). Add a CI check that every `npm run X` in the runbook exists in `package.json` | T11, T19 |
| `AUDIT-FINDINGS.md`, `OPERATOR-DECISIONS.md` | Live registers (T1, T3) | — |

---

## 8. Feature Dependencies

```
[T1 Findings register] ──┬──> [T3 Operator decisions] ──> [behavior-changing fixes]
[T2 Bug-class sweep] ────┘            ▲
[T4 Thresholds inventory] ────────────┘

[X1 Real-path harness] ──> [T6 Capital fixes w/ RED tests] ──> [T7 Restructure]
            │                                                    ▲
            └──> [T5 Characterization tests] ────────────────────┘
                         │
                         └──> [T11 Dependency/tooling majors] (net must exist first)

[T9 Formatter one-shot] ──> [T7 Restructure] ──> [T8 Lint-zero per new module]
                                    │                  └──> [X6 type-coverage]
                                    ├──> [X4 signer seam / X5 dep-cruiser]
                                    ├──> [X10 ADRs] ──> [T18 Architecture doc]
                                    └──> [T10 knip dead code]

[T12 Mock-the-mechanism rewrite] ──> [T13 Coverage floor] ──> [T14 CI coverage gate]
                └──> [X2 Stryker baseline] ──> [mutation break threshold]

[T11 ts-node replaced] ──> [T19 Runbook] ──> [T20 Fork rehearsal + live roundtrip]
[ALL money-path work] ──────────────────────> [T20]

[X7 Typed bindings] ──enhances──> [T8 Lint-zero] (removes no-unsafe-* at source)
[X8 Validated config] ──enhances──> [A4/A5/I2/I3 fixes]  (needs OD card for defaults)
[A2 viem swap] ──conflicts──> [T20 live re-proof / Flashbots provider]
[A6 fix-in-move commits] ──conflicts──> [T5 snapshot attribution]
```

### Dependency notes

- **T5 before T7 and T11.** Characterization snapshots are the only thing that proves a 2,000-line split or an ethers/TS/Vitest major didn't change calldata or exit decisions.
- **T6 before T7, per area.** S0/S1 fixes land in the familiar layout as small reviewed diffs, and the restructure then moves already-fixed code. Fixing during the move violates A6.
- **X1 underpins T6 and T12.** Without a real-ethers, fake-transport harness, a "real-path" test can't be written cheaply and the suite keeps sliding back into mocking.
- **T8 after T7 (per module), except the promise-class rules.** Floating and misused promises (F1/F2) are capital findings and get fixed as T6 items early. The bulk `no-unsafe-*` cleanup happens as each module is extracted, so the same file isn't cleaned twice.
- **T9 before T7**, so moves don't carry formatting noise.
- **T13 after T12.** A floor measured on mock-heavy tests is meaningless.
- **T20 last.** Every money-path change, the `ts-node` replacement and the runbook update must be done first, plus the decision on anti-rug dry-run arming (L1).

---

## 9. MVP Definition (what the milestone must close with)

### Must close (done bar)

- [ ] T1, T2, T3, T4: register, sweep, decision log, thresholds inventory. Nothing else is trustworthy without them.
- [ ] T5 and X1: characterization net and real-path harness. These are the safety precondition for every structural change.
- [ ] T6: every confirmed S0/S1 capital finding fixed with RED→GREEN proof. Strong seeds: E2, B3, F4, F1, A4, E4, K1, A2, D1/D2, B1 (decision).
- [ ] T7: restructure by domain with `utils/` dissolved.
- [ ] T8, T9, T10: lint-zero, formatted, dead code gone.
- [ ] T11: latest majors, zero prod vulns, no `--legacy-peer-deps`, `ts-node` gone.
- [ ] T12, T13, T14: real-path tests, money-path floor, strict CI.
- [ ] T15, T16, T17: dashboard, scripts and tooling, hygiene.
- [ ] T18, T19: architecture doc, README, runbook.
- [ ] T20: fork rehearsal plus live roundtrip.

### Strongly recommended (high value per cost)

- [ ] X4 signer seam and X5 boundaries: make nonce-authority violations unrepresentable.
- [ ] X3 fast-check on money math and lock interleavings.
- [ ] X7 typed bindings: the fastest honest path through the 102 + 78 + 33 `no-unsafe-*` errors.
- [ ] X8 validated config: closes the NaN fail-open class.
- [ ] X9 `op`-taxonomy contract and X10 ADRs.

### Add if time allows (P3)

- [ ] X2 Stryker break thresholds (measure the baseline at minimum).
- [ ] X12 write-ahead intent row (needs a decision card plus a schema bump).
- [ ] X13 bytecode equivalence, X14 chaos tests, X6 type-coverage gate, X11 Renovate cooldown.

---

## 10. Prioritization Matrix

| Deliverable | Capital-safety value | Cost | Priority |
|-------------|----------------------|------|----------|
| T1–T4 audit + decisions | HIGH | MEDIUM | P1 |
| T5 characterization + X1 harness | HIGH | HIGH | P1 |
| T6 capital fixes | HIGH | MEDIUM | P1 |
| T7 restructure | MEDIUM (enabler) | HIGH | P1 |
| T8–T10 quality | MEDIUM | MEDIUM | P1 |
| T11 upgrades / vulns | MEDIUM | HIGH | P1 |
| T12–T14 tests / CI | HIGH | HIGH | P1 |
| T15–T17 dashboard / scripts / hygiene | MEDIUM | LOW–MEDIUM | P1 |
| T18–T19 docs / runbook | MEDIUM | MEDIUM | P1 |
| T20 live re-proof | HIGH | MEDIUM | P1 (last) |
| X4/X5 structural boundaries | HIGH | MEDIUM | P2 |
| X3 property tests | HIGH | MEDIUM | P2 |
| X7 typed bindings | MEDIUM | MEDIUM | P2 |
| X8 validated config | HIGH | MEDIUM | P2 |
| X9/X10 op contract, ADRs | MEDIUM | LOW–MEDIUM | P2 |
| X2 Stryker | MEDIUM | MEDIUM | P3 (baseline P2) |
| X12 intent row | HIGH | MEDIUM | P2/P3 (decision-gated) |
| X11/X13/X14 | MEDIUM | LOW–MEDIUM | P3 |

---

## 11. Reference-Practice Comparison

| Practice | Pro smart-contract audit firms | Code4rena / contest style | Our approach |
|----------|--------------------------------|---------------------------|--------------|
| Severity model | Severity × difficulty, plus categories | High / Med / QA by impact × likelihood | Capital-centric S0–S4 plus a capital-impact class (§2.1) |
| Fix tracking | Fix-review status per finding | Judge-confirmed | `candidate → confirmed → decided → fixed → verified`, with an independent re-run of the RED proof |
| Design issues | "Informational" / "Code quality" | QA reports | S4 plus operator decision cards, because behavior changes are the operator's call |
| Evidence | PoC per finding | PoC required for High | RED real-path test, fork script or on-chain artifact (D-EVIDENCE-BAR) |

---

## Sources

- **Codebase (HIGH):** direct reads of `src/bot.ts`, `src/exitEngine.ts`, `src/utils/nonceAuthority.ts`, `src/utils/receiptDecoder.ts`, `src/utils/gasManager.ts`, `src/utils/mevStrategies/{flashbots,passthrough}.ts`, `src/utils/tokenSafety.ts`, `src/utils/db.ts`, `src/riskManager.ts`, `src/config.ts`, `src/telegramListener.ts`, `src/api/{server.ts,middleware/auth.ts,routes/controls.ts,ws/handler.ts}`, plus grep surveys of `test/` (`vi.mock` targets, `readFileSync` usage) at commit `c110201`.
- **Project context (HIGH):** `.planning/PROJECT.md`, `.planning/STATE.md` (Milestone Baseline), `.planning/RETROSPECTIVE.md`.
- **Flashbots, "Post mortem: April 3rd, 2023 mev-boost relay incident"** (first-party): https://collective.flashbots.net/t/post-mortem-april-3rd-2023-mev-boost-relay-incident-and-related-timing-issue/1540. Corroborated by CertiK: https://www.certik.com/blog/mev-bot-incident-analysis (MEDIUM)
- **CertiK, "Maestro & Unibot"**: https://www.certik.com/blog/maestro-and-unibot. Corroborated by https://tradingagentstack.com/telegram-trading-bot-hacks/ and https://www.blockchainbreaches.com/en/breaches/unibot-2023 (MEDIUM)
- **Banana Gun Telegram message-oracle exploit**: https://www.quillaudits.com/blog/hack-analysis/banana-gun-exploit, https://quadrigainitiative.com/casestudy/bananaguntelegrambotwalletsdrained.php (MEDIUM)
- **Salmonella anti-bot token**: https://github.com/Defi-Cartel/salmonella, https://mev.wiki/attempts-to-trick-the-bots/salmonella/, CoinDesk 2021-03-22 (MEDIUM)
- **Malicious/PVP token mechanisms** (FOT, gas-limit tricks, blacklists): https://book.longcipher.com/en/mev/strategies/malicious-tokens/ (LOW–MEDIUM, single secondary source)
- **StrykerJS docs (Context7 `/stryker-mutator/stryker-js`)**: `mutate` globs and line ranges, `thresholds.break`, `--incremental` (MEDIUM)
- **From general knowledge, not re-fetched this session (MEDIUM, verify in STACK):** ethers v6 `getFeeData` maxFee ≈ 2×base + priority and `wait()` error semantics; fast-check `fc.bigInt` / `fc.scheduler`; Vitest glob-keyed coverage thresholds; typescript-eslint `strictTypeChecked`; knip / dependency-cruiser / type-coverage / gitleaks; the 2025 npm maintainer-compromise incidents.

---
*Feature research for: audit and modernization of a production EVM MEV sniper bot (v7.0)*
*Researched: 2026-11-06*
