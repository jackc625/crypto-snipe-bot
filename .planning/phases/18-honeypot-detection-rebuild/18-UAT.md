---
status: complete
phase: 18-honeypot-detection-rebuild
source: [18-00-SUMMARY.md, 18-01-SUMMARY.md, 18-02-SUMMARY.md, 18-03-SUMMARY.md, 18-04-SUMMARY.md, 18-05-SUMMARY.md, 18-06-SUMMARY.md, 18-07-SUMMARY.md, 18-09-SUMMARY.md, 18-10-SUMMARY.md]
started: 2026-05-23T14:00:00Z
updated: 2026-05-23T14:30:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Start the bot from scratch on ETH mainnet config: stop any running process, optionally `rm -rf data/` to clear seed DB, then run `npx ts-node src/bot.ts`. Within ~60s the logs should show `Chain registry built` with eth enabled, chainId 1 match, Flashbots health check passed, PairCreated listeners up, Telegram listener connected, startup alert delivered. No exceptions in first 60s.
result: pass

### 2. TypeScript Compile Clean
expected: `npx tsc --noEmit` exits 0 with no output. Phase 18 introduces HoneypotResult discriminated union, HONEYPOT_CHECKER_ABI tuple, ChainConfig.honeypotChecker field — all must type-check.
result: pass

### 3. Hardhat Compile Clean
expected: `npx hardhat compile` exits 0. Both `contracts/honeypot/HoneypotChecker.sol` and `test/fixtures/contracts/Honeypot.sol` compile under solc 0.8.28. Artifact present at `artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json`.
result: pass

### 4. Unit Test Suite Passes
expected: `npx vitest run --project unit` shows 268+ tests passing across 30+ files. Includes new tests added in Phase 18: honeypotTypes.test.ts (5 compile-gates), bytecodeScan.test.ts (7 tests), honeypotDispatch.test.ts, honeypotTaxThreshold.test.ts, chainRegistry.test.ts (8 new for env overlay + bounds validation).
result: pass
observed: "31 files / 276 tests passed in 2.82s"

### 5. V2 + V3 Integration Tests Pass
expected: `npx vitest run --project integration test/integration/v2HoneypotIntegration.test.ts test/integration/v3HoneypotIntegration.test.ts test/integration/honeypotDispatch.test.ts test/integration/honeypotUnknownFailsClosed.test.ts` exits 0. Verifies V2/V3 honeypots block buy, known-good tokens pass, HONEY-12 bytecode-scan blocks owner-mutable tokens, unknown verdict fails closed.
result: pass
observed: "4 files / 12 tests passed in 1.29s"

### 6. Honeypot Fork Tests Pass
expected: `npx vitest run --project fork test/fork/honeypotChecker.fork.test.ts test/fork/honeypotMultiAmount.fork.test.ts` (against pinned mainnet fork) exits 0. Verifies contrived Honeypot.sol modes 0-3 + V3 fixture all return `verdict !== 'safe'`; multi-amount 1%/50%/100% probe aggregation enforces tax threshold.
result: pass
observed: "2 files / 9 tests passed in 13.56s; cleared stale hardhat node on port 8545 (PID 14960) before run"

### 7. Bot Wiring V2 — Honeypot Roundtrip Gate
expected: `src/bot.ts` around line 238 (V2 path) calls `await simulateHoneypotRoundtrip(ctx, dex, targetToken)` BEFORE the `Promise.all` parallel safety bank. If `verdict !== 'safe'`, the buy is blocked with a `*SKIP*` Telegram alert including verdict, reason, and tax bps. Verify by grep: `grep -n simulateHoneypotRoundtrip src/bot.ts` returns 2 hits (V2 + V3).
result: pass
observed: "Call at line 238 (V2). Verdict check 239. SKIP alert 250-263. Promise.all at line 282. 2 grep hits total (lines 238 + 485)."

### 8. Bot Wiring V3 — Honeypot Roundtrip Gate
expected: `src/bot.ts` V3 buy path (around line 459) also calls `simulateHoneypotRoundtrip` before its parallel safety bank, with the same fail-closed alert. V3 path uses `dex.dexType === 'v3'` which routes to `simulateViaContractV3` via the dispatch in `src/utils/honeypot/index.ts`.
result: pass
observed: "Call at bot.ts:485 with feeTier; SKIP alert 497-510; Promise.all 526. Dispatch in src/utils/honeypot/index.ts line 65 switches on dex.dexType → line 69 routes V3 to simulateViaContractV3 with feeTier default 3000."

### 9. Mutable-Token Bytecode Scan Wiring (HONEY-12)
expected: `isMutableTokenForChain` is in the `Promise.all` tuple of BOTH V2 and V3 parallel safety banks in `src/bot.ts` (V2: 8th-9th element ~line 290, V3: similar position in V3 block). Returns `{ isMutable, hits }`; positive hit blocks the buy with a "mutable token" reason. Verify: `grep -n isMutableTokenForChain src/bot.ts` returns 2+ hits.
result: pass
observed: "V2: line 282 destructures mutableResult, line 290 calls fn, line 333 skip condition includes mutableResult.isMutable, line 334 logs mutable+mutableHits. V3 path: same pattern at lines 526/531/557/558."

### 10. Vestigial Sell-Sim Code Removed
expected: `simulateSellForChain` and `simulateSellV3ForChain` no longer exist in `src/utils/tokenSafety.ts`. Verify: grep returns 0 hits.
result: pass
observed: "2 grep hits — both in a removal-tombstone comment block at lines 559-567 documenting D-ROLLBACK. The function definitions themselves are gone. Intent satisfied; tombstone comment is a minor style nit, not a defect."

### 11. Wave-5 Placeholder Sentinel Removed
expected: The literal string `NOT_IMPLEMENTED: checkerContract wave-5 deliverable` is no longer in `src/utils/honeypot/checkerContract.ts`. Verify: grep returns 0 hits.
result: pass
observed: "0 grep hits. Sentinel cleanly removed; real Option-D wrapper in place."

### 12. HoneypotChecker Contract Live on Mainnet
expected: `npx ts-node scripts/audit-honeypot-checker.ts` reports bytecode present at deployed address, length+hash non-zero, total tx ≈ 1, creator matches deploy wallet, no anomalous traffic, chainRegistry literal matches.
result: issue
reported: "Etherscan API returned NOTOK because scripts/audit-honeypot-checker.ts calls deprecated V1 endpoint. Etherscan response: 'You are using a deprecated V1 endpoint, switch to Etherscan API V2 using https://docs.etherscan.io/v2-migration'. ETHERSCAN_API_KEY is set correctly in .env — the script itself is broken. Partial pass: on-chain bytecode check works (9278 bytes, hash 0x6b3e1a14...b2ad), chainRegistry literal matches, but tx-history / creator / wallet-activity portions of audit are unreachable."
severity: major

### 13. chainRegistry Literal Matches Ignition Deployment
expected: chainRegistry.ts ETH literal matches ignition/deployments/chain-1/deployed_addresses.json. No drift.
result: pass
observed: "Ignition: 'HoneypotCheckerModule#HoneypotChecker': '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD'. chainRegistry.ts:177 defaultHoneypotCheckerAddress: same address. Match confirmed."

### 14. Mythril Severity Gate CLI Behaves Correctly
expected: Clean fixture exits 0 with 'Mythril clean'; high-severity fixture exits 1 with [High] detail + 'Mythril found 1 Medium+ issues'; no-arg exits 1 with usage.
result: pass
observed: "All 3 paths matched: clean exit=0 'Mythril clean (no Medium+ issues; total issues=0)'; high exit=1 '[High] Test high (swc=100, x.sol:1)\\nMythril found 1 Medium+ issues'; no-arg exit=1 'Usage: ts-node check-mythril-report.ts <report.json>'"

### 15. Audit Milestone Document Exists
expected: v6.17 audit milestone doc exists, documents Slither + Mythril findings + dispositions, gates deploy.
result: pass
observed: ".planning/milestones/v6.17-honeypot-checker-audit.md exists (27,949 bytes). Frontmatter: 13 Slither findings (4 High + 9 Medium), 0 Mythril Medium+. Disposition: 0 fix-applied, 13 false-positive, 0 accepted-risk. Deploy gate: cleared-for-HONEY-03. Tool versions + per-host install path documented (D-AUDIT-PATH)."

### 16. Tax-Threshold Env Var Validation
expected: Bad ETH_MAX_BUY_TAX_BPS / ETH_MAX_SELL_TAX_BPS (NaN, negative, >10000) → fatal log + process.exit(1). Valid values load cleanly.
result: pass
observed: "Validation code in chainRegistry.ts:376-389 (parseInt → NaN || <0 || >10000 check, fatal log, exit). Runtime probe with ETH_MAX_BUY_TAX_BPS=15000 fired exact log: 'Tax threshold env var must be a valid bps integer in [0, 10000]' (chain=eth, key=ETH_MAX_BUY_TAX_BPS, value=15000) followed by process.exit(1). NaN/negative paths covered by chainRegistry.test.ts (passed in test 4)."

## Summary

total: 16
passed: 15
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "scripts/audit-honeypot-checker.ts reports total tx on contract, creator address, and deploy-wallet activity via Etherscan"
  status: failed
  reason: "User reported: Etherscan V1 API is deprecated; script calls V1 endpoint (https://api.etherscan.io/api?...). Etherscan returns NOTOK with message: 'switch to Etherscan API V2 using https://docs.etherscan.io/v2-migration'. ETHERSCAN_API_KEY is set; V2 endpoint requires chainid param and base URL https://api.etherscan.io/v2/api."
  severity: major
  test: 12
  artifacts:
    - path: "scripts/audit-honeypot-checker.ts"
      issue: "Calls deprecated Etherscan V1 endpoint at line ~45 (txlist) and ~73 (wallet txlist) — needs V2 migration (base URL https://api.etherscan.io/v2/api + chainid=1 query param)"
  missing:
    - "Migrate the two Etherscan API calls in scripts/audit-honeypot-checker.ts to V2 endpoint format per https://docs.etherscan.io/v2-migration"
  root_cause: "Etherscan deprecated V1 API; the audit script was written against V1 and was never updated"
  debug_session: ""
