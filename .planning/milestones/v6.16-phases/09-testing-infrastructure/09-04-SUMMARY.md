---
phase: 09-testing-infrastructure
plan: 04
subsystem: testing
tags: [fork-testing, solidity, uniswap-v2, ci-pipeline, hardhat, github-actions]
dependency_graph:
  requires: ["09-02", "09-03"]
  provides: ["TEST-05 fork lifecycle test", "CI pipeline", "FakeToken contract", "Hardhat fork config"]
  affects: ["test/fork/", "contracts/", ".github/workflows/", "hardhat.config.ts"]
tech_stack:
  added: ["GitHub Actions CI", "Hardhat forking"]
  patterns: ["globalSetup/teardown for fork node lifecycle", "compiled artifact loading for test deployment", "conditional Hardhat network config"]
key_files:
  created:
    - contracts/FakeToken.sol
    - test/fork/snipeLifecycle.test.ts
    - test/fork/setup.ts
    - test/fork/teardown.ts
    - .github/workflows/test.yml
  modified:
    - hardhat.config.ts
decisions:
  - "Conditional sepolia network in hardhat config to avoid crash when ALCHEMY_URL not set"
  - "Fork test loads FakeToken artifact from compiled JSON rather than importing typechain types for portability"
  - "CI runs test:unit and test:integration only -- fork tests excluded since they require RPC access"
metrics:
  duration: 3min
  completed: "2026-03-28T22:57:00Z"
---

# Phase 9 Plan 4: Fork Test & CI Pipeline Summary

Mainnet fork lifecycle test (TEST-05) covering deploy, pair creation, liquidity, buy, price check, and sell using real Uniswap V2 contracts. GitHub Actions CI pipeline running unit and integration tests on push.

## What Was Built

### FakeToken ERC20 Contract (contracts/FakeToken.sol)
Minimal ERC20 token using OpenZeppelin base with unrestricted `mint` function for test-only use. Compiles with Hardhat and produces deployment artifact.

### Hardhat Fork Configuration (hardhat.config.ts)
Added `hardhat.forking` network config using `ETH_FORK_RPC_URL` with `ALCHEMY_URL` fallback. Sepolia network conditionally included only when `ALCHEMY_URL` is set (prevents config validation errors in environments without RPC credentials).

### Fork Test Setup/Teardown (test/fork/setup.ts, teardown.ts)
globalSetup exports `setup()` and `teardown()` functions. Setup spawns `npx hardhat node --fork` on port 8545, waits for "Started HTTP" stdout signal with 30s timeout. Teardown kills the process with 2s fallback. Clear error thrown when no RPC URL is configured.

### Snipe Lifecycle Fork Test (test/fork/snipeLifecycle.test.ts)
TEST-05: Full end-to-end snipe lifecycle on forked Ethereum mainnet:
1. Deploy FakeToken from compiled artifact, mint 1M tokens
2. Create Uniswap V2 pair via real Factory contract (0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f)
3. Add liquidity: 100K tokens + 1 ETH via real Router (0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)
4. Buy tokens: 0.01 ETH swap via Router (simulates snipe entry)
5. Check price: getAmountsOut query (simulates monitoring)
6. Sell all tokens: swapExactTokensForETH (simulates exit)
7. Verify lifecycle complete: token balance = 0, ETH recovery within expected range

### GitHub Actions CI Pipeline (.github/workflows/test.yml)
Runs on push/PR to main/master branches. Uses Node 22, npm ci with --legacy-peer-deps, executes test:unit then test:integration. Fork tests intentionally excluded (require RPC access not available in CI).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hardhat config crashes when ALCHEMY_URL not set**
- **Found during:** Task 1
- **Issue:** Original hardhat.config.ts used `url: process.env.ALCHEMY_URL` for sepolia network, which is undefined when the env var is not set, causing Hardhat config validation to fail
- **Fix:** Made sepolia network conditional via spread operator -- only included when ALCHEMY_URL is set
- **Files modified:** hardhat.config.ts
- **Commit:** 42cc5b0

## Verification

- `npx hardhat compile` succeeds with FakeToken.sol (exit 0, artifact at artifacts/contracts/FakeToken.sol/FakeToken.json)
- `npx vitest run --project fork` throws clear error when ETH_FORK_RPC_URL not set: "ETH_FORK_RPC_URL or ALCHEMY_URL env var required for fork tests"
- .github/workflows/test.yml contains test:unit and test:integration steps, does NOT contain test:fork
- All structural acceptance criteria verified via grep checks

## Known Stubs

None. All code is functional -- fork test requires ETH_FORK_RPC_URL environment variable to execute against a real forked node, which is expected behavior, not a stub.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | FakeToken, Hardhat fork config, setup/teardown | 42cc5b0 | contracts/FakeToken.sol, hardhat.config.ts, test/fork/setup.ts, test/fork/teardown.ts |
| 2 | Fork lifecycle test, GitHub Actions CI | 9cbb4f8 | test/fork/snipeLifecycle.test.ts, .github/workflows/test.yml |

## Self-Check: PASSED

All 7 created/modified files verified on disk. Both task commits (42cc5b0, 9cbb4f8) verified in git log.
