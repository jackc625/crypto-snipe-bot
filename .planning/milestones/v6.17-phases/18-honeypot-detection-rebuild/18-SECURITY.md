---
phase: 18
slug: honeypot-detection-rebuild
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-23
---

# Phase 18 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Phase: honeypot detection rebuild (10 of 11 plans executed; plan 18-08 deferred).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Bot RPC → HoneypotChecker contract (V2 + V3) | Untrusted token bytecode executes inside `eth_call`; trust boundary is the contract's revert-at-end invariant. Applies to both V2 and V3 paths. | token addresses, swap amounts, encoded calldata |
| TypeScript dispatch → contract revert payload | Custom-error decode must handle malformed revert data (truncated, wrong selector, empty) without coercing to `safe`. V2 and V3 have distinct terminal errors (`RoundtripResult` vs `RoundtripResultV3`). | encoded revert bytes |
| `eth_call` `from` field → token's `tx.origin` check | A token gating honeypot behavior on `tx.origin == 0` would bypass detection if `from` is unset. Mitigated by setting `from: ctx.wallet.address` on V2 + V3. | wallet address |
| `.env` → bot runtime (deploy capability) | If `DEPLOY_PRIVATE_KEY` is conflated with bot's `PRIVATE_KEY` (single-key config), a leaked bot key can deploy malicious contracts at trusted addresses. Capability split per D-DEPLOY-KEY. | private keys, RPC endpoints |
| Audit clearance gate → deploy authorization | A rubber-stamp audit decision would bypass D-STOP-THE-LINE. Auto-grep precheck for "NO escalation; deploy gate cleared" enforced before deploy. | audit doc text |
| Deploy wallet → mainnet | Deploy wallet's private key controls which contract address becomes canonical at the chainRegistry slot. | private key, contract bytecode |
| chainRegistry.ts literal defaults → bot dispatch | A wrong literal here routes every honeypot check to attacker-controlled code (per iter-2 Blocker #3). | contract addresses |
| Mythril/Slither JSON report → CI | A malformed report could omit issues; severity-gate CLI defaults to non-zero on parse error. | finding severities |
| Tax threshold env → chainRegistry | A malformed bps env value (negative, > 10000, NaN) silently parsing as 0 would disable the threshold gate. | env strings → number |
| Fixture data → fork tests | A misclassified fixture (real-mainnet token labeled `expectedVerdict: 'unsafe'` that is actually safe at the pinned block) creates false confidence in the gate. | fixture JSON |
| `tokenSafety.ts` gate → bot.ts buy decision | A gate returning a vacuous-safe result on edge case → bot buys an unsafe token. 8 safety-bank gates audited per HONEY-11. | verdict booleans |
| 2-3 day observation gap → batch deploy authorization (DEFERRED) | Premature batch deploy concentrates risk across 4 chains. Plan 18-08 deferred per operator direction 2026-05-22. | operator gate |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-18-00-01 | Tampering | REQUIREMENTS.md HONEY-12 row | mitigate | Plan 18-00 verify grep-asserts exact substrings; downstream PLANs pin via `<read_first>`. | closed |
| T-18-01 | Spoofing | Fixture JSON misclassification | mitigate | `test/fixtures/contracts/Honeypot.sol` 5-mode contrived fixture covers every verdict branch; block-pin debt tracked in `test/fork/fixtures/honeypots/README.md`. | closed |
| T-18-02 | Tampering | Honeypot.sol mode-4 contradiction | mitigate | 4-arg constructor `(string,string,uint8,uint256)` enforced; plan 18-09 only SETS arg, does not extend contract. | closed |
| T-18-03 | Tampering | checkV2 post-buy lying-balanceOf | mitigate | `contracts/honeypot/HoneypotChecker.sol:174-176` — `BUY_BAL_ZERO` require. | closed |
| T-18-04 | Tampering | checkV2 post-sell silent-zero-ETH | mitigate | `contracts/honeypot/HoneypotChecker.sol:228-231` — `SELL_ETH_ZERO` require. | closed |
| T-18-03b | Tampering | checkV3 post-buy lying-balanceOf | mitigate | `contracts/honeypot/HoneypotChecker.sol:318-321` — `BUY_BAL_LIE` require. | closed |
| T-18-04b | Tampering | checkV3 post-sell silent-zero-WETH | mitigate | `contracts/honeypot/HoneypotChecker.sol:386-389` — `V3_SELL_WETH_ZERO` require. | closed |
| T-18-05 | Spoofing | HoneypotResult.verdict 'safe' vacuous literal | mitigate | `src/utils/honeypot/types.ts:51-65` discriminated-union intersection; compile-gate tests in `test/unit/honeypotTypes.test.ts`. | closed |
| T-18-06 | Elevation of Privilege | HoneypotChecker contract upgrade | mitigate | `contracts/honeypot/HoneypotChecker.sol` — 0 matches in code for `selfdestruct`/`tx.origin`/`onlyOwner` (line 92 is `@dev` comment documenting absence). D-CONTRACT-IMMUTABLE structurally enforced. | closed |
| T-18-07 | Denial of Service | Gas-grief in token `_transfer` | accept | Outer `eth_call` gas-limit caps consumption; revert → `verdict: 'unsafe'` is correct semantic per D-AGGREGATION. | closed |
| T-18-08 | Tampering | Dispatch throws on bad method | mitigate | `src/utils/honeypot/index.ts` — 0 matches for `throw new Error`; all branches return `HoneypotResult`. | closed |
| T-18-08b | Tampering | V3 dispatch path bypassed | mitigate | `src/utils/honeypot/index.ts:65-77` — explicit `case 'v3'` switch + exhaustive `never` guard. | closed |
| T-18-08c | Tampering | checkerContract.ts NOT_IMPLEMENTED sentinel shipped | mitigate | Plan 18-09 removed sentinel post-overwrite; 0 matches across `src/`. | closed |
| T-18-09 | Tampering | isMutableTokenForChain getCode error path | mitigate | `src/utils/honeypot/bytecodeScan.ts:105-112` — catch returns `{ isMutable: true, hits: ['scan-failed'] }` fail-closed. | closed |
| T-18-10 | Spoofing | Bytecode case variation false-negative | mitigate | `src/utils/honeypot/bytecodeScan.ts:102-103` — `.toLowerCase()` before substring match. | closed |
| T-18-11 | Tampering | Mythril JSON missing issues key | mitigate | `scripts/check-mythril-report.ts:71` — `(report.issues ?? [])`; JSON.parse wrapped in try/catch with `process.exit(1)`. | closed |
| T-18-12 | Information Disclosure | Selector false-positives blocking DAO tokens | accept | D-BYTECODE: "false positives expected and acceptable"; v6.18 HONEY-V2-02 layers timelock-state inspection. | closed |
| T-18-13 | Spoofing | isBlacklistedTokenForChain getCode throw | mitigate | `src/utils/tokenSafety.ts:357-365` — try/catch returning `true` (fail-closed) with structured warn log. | closed |
| T-18-14 | Spoofing | Other 7 gates regressing to vacuous-pass | mitigate | 8 per-gate regression tests in `test/unit/safetyBank/`; CI fails on any regression. | closed |
| T-18-15 | Tampering | Adapter modules vacuous-pass behind dispatcher | accept | D-AUDIT-BAR scope; deferred to v6.18 audit per `.planning/milestones/v6.17-safety-bank-audit.md` §"What Was NOT Audited". | closed |
| T-18-16 | Tampering | HoneypotChecker.sol shipping medium+ finding | mitigate | `.github/workflows/test.yml:108-116` — `slither --fail-medium`; line 154-155 Mythril severity gate. | closed |
| T-18-17 | Tampering | Future contracts/** PR weakens audit threshold | mitigate | `--fail-medium` evergreen in CI workflow; `contracts/**` paths-filter gate. Any removal requires explicit PR diff. | closed |
| T-18-18 | Information Disclosure | Audit output left in working tree | accept | `.gitignore:55-56` excludes `reports/*`; `reports/.gitkeep` preserves dir. | closed |
| T-18-19 | Repudiation | accepted-risk without owner sign-off | mitigate | `.planning/milestones/v6.17-honeypot-checker-audit.md:25` frontmatter `accepted-risk: 0`; 13/13 false-positive dispositions. | closed |
| T-18-20 | Elevation of Privilege | Bot wallet has deploy authority | mitigate | `hardhat.config.ts:50-91` — all 4 mainnet networks use `DEPLOY_PRIVATE_KEY` exclusively per D-DEPLOY-KEY. | closed |
| T-18-21 | Tampering | Tax threshold env values out of range | mitigate | `src/chainRegistry.ts:376-388` — NaN/0-10000 guard with `log.fatal + process.exit(1)`; tests 6/7/8 exercise paths. | closed |
| T-18-22 | Information Disclosure | DEPLOY_PRIVATE_KEY left in .env | mitigate | `scripts/deploy-honeypot-checker.ts:64` — fatal message instructs rotation; operational enforcement (operator runbook). | closed |
| T-18-23 | Repudiation | Auto-update of chainRegistry leaves no audit trail | mitigate | `scripts/deploy-honeypot-checker.ts:109-115` — no auto-modify; manual paste preserves git trail (commit `ae768f4`). | closed |
| T-18-24 | Elevation of Privilege | Compromised DEPLOY_PRIVATE_KEY → malicious contract at trusted address | mitigate | `scripts/deploy-honeypot-checker.ts:75-82` fatal-exits if `DEPLOY_PRIVATE_KEY === PRIVATE_KEY` (hardening beyond plan spec). D-CONTRACT-IMMUTABLE blocks upgrade path. Operator visual-audit on Etherscan confirmed per 18-07 SUMMARY. | closed |
| T-18-25 | Tampering | Address pasted differs from actual deploy | mitigate | `test/integration/honeypotDeploy.eth.test.ts:45-53` cross-checks ignition `deployed_addresses.json` against `src/chainRegistry.ts:177` literal. | closed |
| T-18-25b | Tampering | Audit-gate rubber-stamp (iter-2 Blocker #4) | mitigate | Auto-grep precheck for `NO escalation; deploy gate cleared for HONEY-03` at `.planning/milestones/v6.17-honeypot-checker-audit.md:214`. | closed |
| T-18-26 | Spoofing | Bypassed Etherscan verification | mitigate | `npx hardhat verify --network mainnet 0x8243…13eD` succeeded; operator visual-confirmed V2+V3 in verified source per 18-07 SUMMARY verify-gate. | closed |
| T-18-27 | Denial of Service | Plan 18-08 starts before 2-3 day observation | mitigate | Observation window 2026-05-19→2026-05-22 closed cleanly per 18-07 SUMMARY. Plan 18-08 deferred separately per operator direction. | closed |
| T-18-27b | Tampering | chainRegistry.ts literal differs from Etherscan bytes | mitigate | `src/chainRegistry.ts:177` — literal `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD` (single-line addition); integration test cross-checks ignition artifact. | closed |
| T-18-32 | Spoofing | tx.origin spoofing (PITFALLS #4) V2+V3 | mitigate | `src/utils/honeypot/checkerContract.ts:307` (V2) + `:403` (V3) — both `provider.call` invocations include `from: ctx.wallet.address`. | closed |
| T-18-33 | Spoofing | Vacuous-pass regression in checkerContract.ts (V2/V3) | mitigate | `src/utils/honeypot/types.ts:51-65` intersection; `test/integration/honeypotUnknownFailsClosed.test.ts` Tests 4-7 exercise timeout/no-revert/malformed/V3-QuoteFailed. | closed |
| T-18-34 | Tampering | Lying-balanceOf honeypot (V2+V3) | mitigate | `contracts/honeypot/HoneypotChecker.sol:174,318` (V2 + V3 balance-delta requires); `test/fork/honeypotChecker.fork.test.ts:119` mode-1 fork test. | closed |
| T-18-35 | Tampering | Silent-zero-ETH-on-sell (V2+V3) | mitigate | `contracts/honeypot/HoneypotChecker.sol:230` (V2) + `:388` (V3); fork tests modes 3 + V3 contrived dispatch. | closed |
| T-18-36 | Tampering | Mutable tax setter flipped post-deploy V2+V3 | mitigate | `src/bot.ts:290` (V2) + `:531` (V3) — `isMutableTokenForChain` as 9th element of `Promise.all` parallel-bank. HONEY-12 closes. | closed |
| T-18-37 | Denial of Service | Gas-grief V2+V3 | accept | Gas-limit revert → 'unsafe' is correct semantic per D-AGGREGATION (mirrors T-18-07). | closed |
| T-18-38 | Spoofing | V3 silent vacuous-pass regression | mitigate | `src/utils/honeypot/checkerContract.ts:370-439` real `simulateViaContractV3`; `src/bot.ts:485` V3 call site. iter-2 Blocker #1 closes. | closed |
| T-18-39 | Tampering | Dangling imports of deleted sell-sim functions | mitigate | grep over `src/`: 0 `simulateSellForChain`/`simulateSellV3ForChain` call sites in `bot.ts`; only 4 comment-only audit-trail refs. | closed |
| T-18-40 | Tampering | Fork test runs against real mainnet | mitigate | `test/fork/honeypotChecker.fork.test.ts:57-63` — `isHardhatFork` requires `chainId !== 1 OR ALLOW_REAL_MAINNET === '1'`. | closed |
| T-18-41 | Spoofing | iter-2 Warning #9 sentinel in production checkerContract.ts | mitigate | `src/utils/honeypot/checkerContract.ts` — 0 matches for `NOT_IMPLEMENTED: checkerContract wave-5 deliverable` across `src/`. | closed |
| T-18-42 | Tampering | Audit-gate erosion (wrapper before audit clears) | mitigate | 18-09 PLAN `depends_on` includes 18-04 + 18-05 + 18-07; all confirmed committed before 18-09 start. | closed |
| T-18-43 | Tampering | feeTier dropped between bot.ts and V3 wrapper | mitigate | `src/bot.ts:485` — `simulateHoneypotRoundtrip(ctx, dex, targetToken, feeTier)` 4-arg form; `src/utils/honeypot/index.ts:69` passes through. | closed |
| T-18-SC-00..10 | Tampering | npm/pip installs (per-plan supply-chain) | accept / mitigate | Plans 18-00..18-04, 18-06, 18-07, 18-09, 18-10: zero new packages (accept). Plan 18-05: slither + mythril installed from stable PyPI registries (6+/7+ years); CI-only install; Docker fallback uses official `mythril/myth:latest` (mitigate). | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Subtotal: 34 in-scope threats — all CLOSED.**

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-18-01 | T-18-07 | Gas-grief in token `_transfer` (V2): outer `eth_call` gas-limit caps consumption; revert → `verdict: 'unsafe'` is the correct semantic per D-AGGREGATION. | Plan-time disposition (18-02-PLAN) | 2026-05-15 |
| AR-18-02 | T-18-12 | Selector false-positives blocking DAO-controlled tokens: D-BYTECODE accepts; v6.18 HONEY-V2-02 layers timelock-state inspection. | Plan-time disposition (18-03-PLAN) | 2026-05-15 |
| AR-18-03 | T-18-15 | Adapter modules vacuous-pass behind dispatcher: D-AUDIT-BAR scope; deferred to v6.18 audit per `.planning/milestones/v6.17-safety-bank-audit.md` §"What Was NOT Audited". | Plan-time disposition (18-04-PLAN) | 2026-05-16 |
| AR-18-04 | T-18-18 | Audit output left in working tree: `reports/*` gitignored; `reports/.gitkeep` preserves dir. | Plan-time disposition (18-05-PLAN) | 2026-05-17 |
| AR-18-05 | T-18-37 | Gas-grief V2+V3 (wrapper layer): mirrors T-18-07; gas-limit revert → 'unsafe' correct per D-AGGREGATION. | Plan-time disposition (18-09-PLAN) | 2026-05-20 |
| AR-18-06 | T-18-SC-00..04, 06, 07, 09, 10 | Zero new packages added across 9 plans; supply-chain risk inherits from existing dep tree. | Plan-time disposition (per-plan PLANs) | 2026-05-15..22 |
| AR-18-DEFERRED-08 | T-18-28, T-18-29, T-18-30, T-18-31, T-18-31b | Plan 18-08 (BSC/Base/Arb HoneypotChecker deploy) DEFERRED per operator direction 2026-05-22. These threats are forward-looking — they cover preconditions and safeguards for the future multi-chain deploys. The bot dispatch already short-circuits BSC/Base/Arb safely via `verdict: 'unknown'` (D-UNKNOWN-POLICY one-shot skip) because `honeypotChecker.deployedAddress` remains `null` for those chains (`src/chainRegistry.ts:229,274,319`). ENABLED_CHAINS=eth excludes the affected chains entirely. **Re-audit when plan 18-08 ships** — the deferral is contractual, not unconditional. | Operator (jackcutrara) — direction 2026-05-22 captured in 18-10-SUMMARY:45 | 2026-05-23 |

*Accepted risks do not resurface in future audit runs unless their underlying conditions change. AR-18-DEFERRED-08 has an explicit re-audit trigger: plan 18-08 execution.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-23 | 34 (in scope) + 5 (deferred, accepted) | 39 | 0 | gsd-security-auditor (Opus 4.7 1M) |

### Audit Notes — 2026-05-23

- **Scope decision:** Plan 18-08 (BSC/Base/Arb deploy) is DEFERRED per operator direction 2026-05-22 (captured in `.planning/phases/18-honeypot-detection-rebuild/18-10-SUMMARY.md` line 45). Its 5 threats (T-18-28..T-18-31b) are accepted as deferred-pending in AR-18-DEFERRED-08, NOT verified against implementation (no implementation exists for those chains yet).
- **Verification methodology:** For each `mitigate` disposition, the auditor located the cited file:line in implementation and used `Grep`/`Read` to confirm the exact mitigation pattern present. For each `accept` disposition, the auditor cross-verified the per-plan SUMMARY recorded the disposition without stealth conversion.
- **Implementation files modified during audit:** 0 (read-only constraint honored).
- **Cross-cutting findings** (non-blocking; documented as security-architecture observations):
  1. T-18-06 immutability is verified by ABSENCE — zero `selfdestruct`/`tx.origin`/`onlyOwner` in code.
  2. T-18-39 sell-sim deletion is complete; remaining 4 substring matches are comment-only audit-trail references.
  3. T-18-05/T-18-33 discriminated-union enforcement is structurally guaranteed by `tsc --noEmit`.
  4. T-18-20/T-18-24 capability-split hardened beyond PLAN spec: `scripts/deploy-honeypot-checker.ts:75-82` fatal-exits on same-wallet conflation (Plan 18-WR-08 fix-along).
  5. Address-discriminating honeypot is documented as a known limitation in `HoneypotChecker.sol:94-106` with downstream mitigation citations (HONEY-12 + Phase 19); not a register threat.
  6. Reentrancy invariants are load-bearing: `HoneypotChecker.sol:401-426` documents why `nonReentrant` is intentionally omitted (basis for Slither false-positive dispositions).
- **Documentation-hygiene note:** 18-10 SUMMARY uses narrative threat IDs T-18-44..T-18-47 that don't match PLAN-time register IDs. T-18-44 ≡ register T-18-36, T-18-45 ≡ register T-18-43, T-18-46/47 are UX/operational (not security). No unregistered attack surface; not a blocker.
- **Outstanding operator actions** (NOT blockers): (a) rotate `DEPLOY_PRIVATE_KEY` out of `.env` post-deploy (T-18-22 operational); (b) resolve 3 null-block honeypot fixtures (T-18-01; tracked in `test/fork/fixtures/honeypots/README.md`); (c) address D-18-10-01 pre-existing snipeLifecycle fork-test failure in a dedicated phase 19+ tech-debt item.

**Detailed audit evidence:** see `18-SECURITY-AUDIT-DRAFT.md` (companion artifact retained for traceability).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-23 (gsd-security-auditor + orchestrator). Plan 18-08 re-audit trigger captured in AR-18-DEFERRED-08.
