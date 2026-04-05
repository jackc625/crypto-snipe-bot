---
status: diagnosed
trigger: "Investigate why fork tests fail in test/fork/snipeLifecycle.test.ts"
created: 2026-04-04T00:00:00Z
updated: 2026-04-04T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - ethers v6 JsonRpcProvider caches nonces, causing "nonce too low" errors in Hardhat fork tests
test: Ran the full fork test suite with verbose output
expecting: Confirmed - tests 2-3 fail with nonce errors, tests 4-6 fail with reverts (no liquidity exists), test 7 fails with balance assertion
next_action: Report root cause (diagnose-only mode)

## Symptoms

expected: All 7 fork tests pass - deploy token, create pair, add liquidity, buy, check price, sell, verify
actual: 6 of 7 tests fail. Test 1 passes. Tests 2-3 fail with "nonce too low". Tests 4-6 fail with CALL_EXCEPTION reverts. Test 7 fails with "expected 1000000000000000000000000n to be 0n"
errors: |
  Test 2: "Nonce too low. Expected nonce to be 6159 but got 6158"
  Test 3: "Nonce too low. Expected nonce to be 6160 but got 6159"
  Tests 4-6: "execution reverted (no data present; likely require(false) occurred"
  Test 7: "expected 1000000000000000000000000n to be 0n"
reproduction: npx vitest run --project fork --reporter=verbose
started: Pre-existing since creation (commit 9cbb4f8). Tests were never run against a live fork during phase 09-04.

## Eliminated

- hypothesis: Vitest projects config breaks shared describe-level variables between it blocks
  evidence: Vitest runs tests sequentially within a file, closure variables persist. Test 1 sets fakeToken and test 7 successfully reads it (gets balance = mint amount, not undefined error).
  timestamp: 2026-04-04

- hypothesis: Hardhat fork not running / fork URL invalid
  evidence: Test 1 successfully deploys and mints. The nonce value 6158 proves the fork IS active (the Hardhat default account has mainnet nonce > 0 only on a fork). The "Nonce too low" error confirms the node is running and processing requests.
  timestamp: 2026-04-04

- hypothesis: Duplicate ABI entries in fakeToken contract instance cause ethers v6 issues
  evidence: Tested locally - ethers.Interface handles duplicate entries correctly. balanceOf, approve work fine with merged ABIs.
  timestamp: 2026-04-04

- hypothesis: Phase 11 changes caused regression
  evidence: git log shows test file was only ever committed once in 9cbb4f8 (phase 09-04). Never modified since.
  timestamp: 2026-04-04

## Evidence

- timestamp: 2026-04-04
  checked: Git history of test/fork/snipeLifecycle.test.ts
  found: File has only 1 commit (9cbb4f8) - never modified since creation in phase 09-04
  implication: This is a pre-existing bug, not a regression. The test was never validated against a running fork.

- timestamp: 2026-04-04
  checked: Phase 09-04 summary verification section
  found: Verification only tested "throws clear error when ETH_FORK_RPC_URL not set" -- never ran the actual tests against a fork
  implication: The test was written but never executed end-to-end

- timestamp: 2026-04-04
  checked: Ran full fork test suite (npx vitest run --project fork --reporter=verbose)
  found: |
    Test 1 PASSES (deploy + mint). 
    Test 2 FAILS: "Nonce too low. Expected nonce to be 6159 but got 6158" 
    Test 3 FAILS: "Nonce too low. Expected nonce to be 6160 but got 6159"
    Tests 4-6 FAIL: CALL_EXCEPTION reverts (router operations fail because no pair/liquidity was created)
    Test 7 FAILS: balance = 1000000000000000000000000n (full mint amount, unchanged)
  implication: The cascade starts with nonce errors in tests 2-3. Since pair creation and liquidity add both fail, all Uniswap operations (buy, sell, price check) revert. Final balance = mint amount.

- timestamp: 2026-04-04
  checked: ethers v6 JsonRpcProvider nonce caching behavior (github.com/ethers-io/ethers.js/issues/4549)
  found: Known bug - ethers v6 JsonRpcProvider has a default cacheTimeout that causes stale nonce values when sending rapid transactions to Hardhat
  implication: The fix is to set cacheTimeout: -1 when creating the provider, or wrap wallet in NonceManager

- timestamp: 2026-04-04
  checked: Hardhat default account nonce on fork
  found: Nonce ~6158 for 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 - this is the well-known Hardhat account whose private key is public. It has thousands of mainnet transactions from other users.
  implication: High nonce is expected on a mainnet fork. The nonce caching bug is amplified by rapid sequential transactions.

## Resolution

root_cause: |
  ethers v6's JsonRpcProvider caches RPC responses (including eth_getTransactionCount) with a default cacheTimeout. 
  When the test sends transactions across sequential it() blocks, the provider returns a stale cached nonce 
  instead of querying the Hardhat node for the current nonce. This causes "nonce too low" errors starting 
  at test 2 (createPair). Since the pair is never created and liquidity never added, all subsequent 
  Uniswap operations (buy, sell, price check) revert. The final test sees the unchanged mint balance 
  (1,000,000 tokens) instead of 0.

  This is a pre-existing bug from phase 09-04 (commit 9cbb4f8) -- the test was written but never 
  executed against an actual fork.

  Known issue: https://github.com/ethers-io/ethers.js/issues/4549

fix: |
  Change line 42 in test/fork/snipeLifecycle.test.ts from:
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  To:
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 });
  
  This disables the RPC response cache, ensuring every eth_getTransactionCount call hits the node directly.

verification:
files_changed: []
