---
phase: 18-honeypot-detection-rebuild
plan: 10
subsystem: bot-wiring
tags: [honeypot, bot-ts, v2-gate, v3-gate, d-alerts, honey-12, parallel-bank, integration-tests, iter-2-blocker-1, iter-2-warning-8]

# Dependency graph
requires:
  - phase: 18-honeypot-detection-rebuild
    provides: plan 18-09 — simulateHoneypotRoundtrip V2+V3 wrapper at src/utils/honeypot/checkerContract.ts; TODO(18-10) markers in bot.ts at V2 + V3 insertion points; tokenSafety.ts sell-sim DELETIONS
  - phase: 18-honeypot-detection-rebuild
    provides: plan 18-03 — isMutableTokenForChain bytecode-selector scan (HONEY-12 9th-gate function); imported into bot.ts on both V2 and V3 paths by this plan
provides:
  - HONEY-07 closes: V2 in-place honeypot gate calling simulateHoneypotRoundtrip (replaces deleted simulateSellForChain CALL SITE in bot.ts)
  - HONEY-08 closes: V3 in-place honeypot gate calling simulateHoneypotRoundtrip(ctx, dex, token, feeTier) (iter-2 Blocker #1 — V3 wrapper consumed; replaces deleted simulateSellV3ForChain CALL SITE)
  - HONEY-12 closes: isMutableTokenForChain wired as 9th parallel-bank gate on BOTH V2 and V3 paths in bot.ts
  - D-ALERTS — New Token Detected alert augmented with BuyTax/SellTax bps; skip alerts use tiered `*SKIP* token -- verdict (reason) tax: ...` format
  - test/integration/v2HoneypotIntegration.test.ts (3 tests: V2 honeypot blocks; V2 known-good passes; V2 parallel-bank HONEY-12 blocks mutable tokens)
  - test/integration/v3HoneypotIntegration.test.ts (3 tests: V3 honeypot blocks; V3 known-good passes; V3 parallel-bank HONEY-12 blocks mutable tokens)
  - D-18-09-01 fix-along — test/unit/chainRegistry.test.ts:170 updated to expect ETH literal default per plan 18-07 intent
affects: [bot-runtime, mainnet-trading-resume]

# Tech tracking
tech-stack:
  added: []
  removed:
    - "src/bot.ts: simulateSellForChain call site (V2 sell-sim balance=0 hard-block) — replaced with simulateHoneypotRoundtrip"
    - "src/bot.ts: simulateSellV3ForChain call site (V3 sell-sim vacuous-pass) — replaced with simulateHoneypotRoundtrip(ctx, dex, token, feeTier)"
    - "src/bot.ts: TODO(18-10) markers from plan 18-09 commit 3958060 — both consumed by this plan"
  patterns:
    - "In-place gate replacement: V2 + V3 buy paths now share a single `simulateHoneypotRoundtrip` dispatch. V2 omits the feeTier argument (treated as undefined); V3 passes the runtime feeTier from the pool-detection event. Both fail-closed on verdict !== 'safe' with early return + tiered Telegram alert."
    - "Tiered D-ALERTS format: `*SKIP* \\`token\\` -- verdict (reason) tax: buy {bps}bps sell {bps}bps\\n[Etherscan](url)`. Tax suffix is omitted when evidence.buyTaxBps/sellTaxBps are undefined (e.g., 'no-terminal-revert' or RPC-throw paths). Single alert line, no MarkdownV2 escaping required."
    - "Promise.all 9th element pattern: isMutableTokenForChain added as the final element of the parallel-bank tuple on both V2 (bot.ts:261-271) and V3 (~bot.ts equivalent) paths. The conjunction at the resolution point checks `mutableResult.isMutable === false` alongside the other 8 invariants."

key-files:
  created:
    - "test/integration/v2HoneypotIntegration.test.ts — 3 tests covering V2 wiring (HONEY-07 + HONEY-12 9th gate)"
    - "test/integration/v3HoneypotIntegration.test.ts — 3 tests covering V3 wiring (HONEY-08 iter-2 Blocker #1 V3-honeypot-fixture-unsafe + V3-known-good-safe + HONEY-12 9th gate)"
  modified:
    - "src/bot.ts (V2 gate at line 232 replaced; V3 gate at line 459 replaced; isMutableTokenForChain added as 9th element of both parallel-bank Promise.all calls; conjunction at resolution extended with mutableResult.isMutable; New Token Detected alert at line ~268 augmented with BuyTax/SellTax bps; tiered D-ALERTS skip-alert format applied on both gates; TODO(18-10) markers consumed)"
    - "test/unit/chainRegistry.test.ts (Test 1 updated per D-18-09-01 fix-along — ETH branch now expects the canonical literal default `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`; BSC/Base/Arb branches still expect null until plan 18-08)"
    - ".planning/phases/18-honeypot-detection-rebuild/deferred-items.md (D-18-09-01 marked Resolved; D-18-10-01 logged for pre-existing snipeLifecycle.test.ts fork-setup failure)"

key-decisions:
  - "Plan 18-08 NOT advanced: per operator direction 2026-05-22 the BSC/Base/Arb multi-chain HoneypotChecker deploy (plan 18-08) is deferred. Plan 18-10 ships with the bot wired to use chainRegistry's runtime overlay — operators on BSC/Base/Arb will see verdict='unknown' (one-shot skip per D-UNKNOWN-POLICY) because their honeypotChecker.deployedAddress remains null. ETH is the only chain currently in ENABLED_CHAINS so this is non-blocking; once 18-08 lands the dispatch automatically picks up the literal defaults without further bot.ts changes."
  - "D-18-09-01 fix-along committed atomically as `fix(18-10)`, separately from the wiring commit. Aligned with plan 18-07's key-decisions: the ETH HoneypotChecker literal IS the canonical default and the env overlay (`ETH_HONEYPOT_CHECKER_ADDRESS`) is the operator override. Test now iterates BSC/Base/Arb for the null invariant and asserts ETH against the committed literal."
  - "D-ALERTS tax-suffix is conditionally appended only when BOTH buyTaxBps AND sellTaxBps are defined on the evidence. The discriminated-union HoneypotResult intersection requires both fields for verdict='safe', but skip-alert paths (verdict ∈ {'unsafe', 'unknown'}) may have undefined tax fields — emitting `tax: buy undefinedbps sell undefinedbps` would be ugly and misleading, so the suffix is suppressed in that case."
  - "Pre-existing snipeLifecycle.test.ts failure confirmed UNRELATED to plan 18-10. Reverted the test file to commit 1c77e85 (before 18-10 wiring) and the same socket-boundary error reproduced — this is fork-test infrastructure debt, not a 18-10 regression. Logged as D-18-10-01 in deferred-items.md for future phase 19+ cleanup. The 6 plan-18-10 integration tests pass cleanly; full unit + integration count is 425 pass / 7 fail (all 7 in the one pre-existing fork file)."

# Threat coverage delta
threats-mitigated:
  - "T-18-43 (Wired-but-untested wrapper): plan 18-10 ships 6 integration tests (3 V2 + 3 V3) that exercise the bot.ts call path end-to-end — vi.mock-driven, no live mainnet — asserting that verdict='unsafe' causes early-return and verdict='safe' falls through to the parallel bank."
  - "T-18-44 (Mutable-tax tokens slip past safety bank): isMutableTokenForChain is now the 9th element of the V2 AND V3 parallel banks. Tokens with setTax/setBlacklist/pauseTrading bytecode selectors block on isMutable=true. Closes HONEY-12."
  - "T-18-45 (V3 dispatch ignored feeTier): bot.ts V3 call site explicitly passes `feeTier` (existing local variable in the V3 handler scope) as the 4th argument to simulateHoneypotRoundtrip. The plan-18-09 dispatch in src/utils/honeypot/index.ts routes this through to simulateViaContractV3 — iter-2 Blocker #1 closes here."
  - "T-18-46 (Alert fatigue from undifferentiated skip events): tiered D-ALERTS format gives operator-actionable signal — verdict + reason + tax bps. Replaces the iter-1 'snipe failed' single-line alert that dropped honeypot context."
  - "T-18-47 (Mainnet trading paused indefinitely): with plan 18-10 landed, the bot V2 + V3 gates are live and the bot can resume ETH mainnet snipes. BSC/Base/Arb remain off until plan 18-08 deploys their HoneypotChecker contracts (ENABLED_CHAINS=eth per CONTEXT.md line 60-63)."

# Follow-ups for downstream plans
followups:
  - "Plan 18-08 (DEFERRED per operator direction 2026-05-22): deploy HoneypotChecker.sol to BSC + Base + Arbitrum mainnets; source-verify; commit 3 chainRegistry literal defaults; ship 3 integration tests. When 18-08 lands, bot.ts will automatically pick up the new defaults — no bot.ts re-wire required. The runtime check `if (deployedAddress === null) return verdict: 'unknown'` short-circuits BSC/Base/Arb traffic safely until then."
  - "D-18-10-01 (test/fork/snipeLifecycle.test.ts socket-setup failure): pre-existing tech debt, NOT a 18-10 regression. Deferred to phase 19 (anti-rug runtime monitoring) or earlier dedicated fork-test infrastructure cleanup. The 6 plan-18-10 integration tests are vi.mock-driven and do NOT depend on the broken fork infrastructure."
  - "ETH HoneypotChecker observation window: 18-07 deploy was 2026-05-19; operator deferred 18-08 pending clean observation. Once operator confirms no on-chain anomalies, schedule 18-08 as a separate gated session."
  - "REQUIREMENTS.md status: HONEY-07, HONEY-08, HONEY-12 ALL closed by 18-10 (in addition to HONEY-09, HONEY-10 closed by 18-09). HONEY-04 remains open (closes with 18-08 multi-chain deploys)."

# Verification artifacts
verification:
  test_command: "npx vitest run --reporter=default"
  test_files_run:
    - "test/integration/v2HoneypotIntegration.test.ts (3/3 pass)"
    - "test/integration/v3HoneypotIntegration.test.ts (3/3 pass)"
    - "test/unit/chainRegistry.test.ts (Test 1 now passes after D-18-09-01 fix-along)"
    - "Full suite: 425/432 pass (7 fail in pre-existing test/fork/snipeLifecycle.test.ts — D-18-10-01)"
  tsc_command: "npx tsc --noEmit -p tsconfig.json"
  tsc_result: "Clean (no errors)"
  grep_gates:
    - "grep -c 'TODO(18-10)' src/bot.ts == 0 — markers consumed"
    - "grep -nE 'simulateSellForChain|simulateSellV3ForChain' src/bot.ts only shows comment-block references (audit trail; no live calls)"
    - "grep -c 'simulateHoneypotRoundtrip' src/bot.ts >= 3 (1 import + 2 call sites V2/V3)"
    - "grep -c 'isMutableTokenForChain' src/bot.ts >= 3 (1 import + 2 parallel-bank elements V2/V3)"

---

# Self-Check: PASSED

**Files claimed to be created/modified — verified to exist:**
- `src/bot.ts` — FOUND (modified per commit `8083c96`)
- `test/integration/v2HoneypotIntegration.test.ts` — FOUND (created per commit `95e0e51`)
- `test/integration/v3HoneypotIntegration.test.ts` — FOUND (created per commit `95e0e51`)
- `test/unit/chainRegistry.test.ts` — FOUND (modified per commit `8badd7b`)
- `.planning/phases/18-honeypot-detection-rebuild/deferred-items.md` — FOUND (modified per commit `8badd7b` and metadata commit below)

**Commits claimed — verified in git log:**
- `8083c96` — FOUND (feat(18-10): wire simulateHoneypotRoundtrip into bot.ts V2+V3 gates + HONEY-12 9th gate + D-ALERTS)
- `95e0e51` — FOUND (test(18-10): add V2 + V3 bot.ts integration tests)
- `8badd7b` — FOUND (fix(18-10): resolve D-18-09-01 chainRegistry.test.ts ETH literal default expectation)

**Plan must-haves verified:**
- bot.ts:232 V2 gate calls simulateHoneypotRoundtrip — VERIFIED (grep)
- bot.ts:459 V3 gate calls simulateHoneypotRoundtrip(ctx, dex, targetToken, feeTier) — VERIFIED (grep)
- bot.ts parallel-bank includes isMutableTokenForChain as 9th element on V2 AND V3 paths — VERIFIED (grep)
- bot.ts alert format augmented with BuyTax/SellTax bps per D-ALERTS — VERIFIED (line 244-252 tax suffix construction)
- No `simulateSellForChain` / `simulateSellV3ForChain` CALLS in src/bot.ts — VERIFIED (only audit-trail comments at lines 230, 456 remain)
- No `TODO(18-10)` markers — VERIFIED (grep returns 0)
- test/integration/v2HoneypotIntegration.test.ts + test/integration/v3HoneypotIntegration.test.ts pass — VERIFIED (3+3 = 6/6 pass)
- D-18-09-01 fix-along applied and committed — VERIFIED (commit 8badd7b; deferred-items.md updated)
- tsc --noEmit clean — VERIFIED

**Phase 18 status post-18-10:** 10 of 11 plans complete (18-00..18-07, 18-09, 18-10). Plan 18-08 (BSC/Base/Arb multi-chain deploy) DEFERRED per operator direction; phase 18 verification will NOT run until 18-08 lands. Bot is wired and ready to resume ETH mainnet trading at the operator's discretion.
