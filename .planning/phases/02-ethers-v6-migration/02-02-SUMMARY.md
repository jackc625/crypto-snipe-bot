---
phase: 02-ethers-v6-migration
plan: 02
subsystem: infra
tags: [ethers, v6, bigint, migration, typescript, providers, staticCall]

# Dependency graph
requires:
  - phase: 02-ethers-v6-migration
    plan: 01
    provides: ethers v6.16.0 dependency, ESLint BigInt guardrails, 5 light-migrated files
provides:
  - All 7 remaining source files migrated from ethers v5 to v6 API
  - Full project TypeScript compilation with zero errors
  - Native BigInt arithmetic replacing all BigNumber operations
  - v6 staticCall pattern replacing all callStatic usage
  - v6 waitForDeployment/getAddress replacing .deployed()/.address
affects: [all downstream phases consuming ethers APIs]

# Tech tracking
tech-stack:
  added: [@nomicfoundation/hardhat-ignition@0.15.15, @nomicfoundation/ignition-core@0.15.15]
  patterns: [native BigInt operators for all wei arithmetic, staticCall for simulations, waitForDeployment for deploy scripts, getAddress() for contract addresses, ethers.parseEther/formatEther flat namespace]

key-files:
  created: []
  modified: [src/utils/gasManager.ts, src/utils/txManager.ts, src/alphaDrop.ts, scripts/addLiquidity.ts, src/bot.ts, src/utils/tokenSafety.ts, scripts/deploySepoliaTest.ts, package.json, package-lock.json]

key-decisions:
  - "Used ethers.Contract wrapper for ContractFactory-deployed factory contract when calling custom methods (v6 BaseContract type lacks ABI methods)"
  - "BigInt(CONFIG.gasLimit || 300_000) wrapping for config values that may be number type"

patterns-established:
  - "v6 staticCall: router.method.staticCall(args) replaces router.callStatic.method(args)"
  - "v6 deploy pattern: await contract.waitForDeployment() then await contract.getAddress()"
  - "v6 BigInt arithmetic: balance === 0n, amount * BigInt(x) / 100n, maxWrapAmount > 0n"
  - "v6 flat namespace: ethers.parseEther(), ethers.formatEther(), ethers.Interface() -- no utils sub-namespace"
  - "v6 fee data: (await provider.getFeeData()).gasPrice replaces provider.getGasPrice()"

requirements-completed: [ETH6-01, ETH6-02, ETH6-03]

# Metrics
duration: 10min
completed: 2026-03-22
---

# Phase 02 Plan 02: Full Source Migration & Compilation Verification Summary

**All 7 remaining source files migrated from ethers v5 to v6 with native BigInt, staticCall, and flat imports -- full project compiles clean with zero v5 patterns**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-22T14:59:27Z
- **Completed:** 2026-03-22T15:09:45Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Migrated all 7 remaining source files from ethers v5 to v6 API (gasManager, txManager, alphaDrop, addLiquidity, bot, tokenSafety, deploySepoliaTest)
- Replaced all BigNumber class usage with native BigInt operators (mul/div/sub/add/eq/gt/lt/isZero -> *, /, -, +, ===, >, <, === 0n)
- Converted all callStatic.method() to method.staticCall() (3 occurrences in tokenSafety)
- Converted all .deployed()/.address to .waitForDeployment()/.getAddress() (4+ occurrences in deploySepoliaTest)
- Migrated all ethers.utils.* and ethers.constants.* to v6 flat namespace (parseEther, formatEther, Interface, parseUnits)
- Full `npx tsc --noEmit` compiles with zero errors
- `npx hardhat compile` succeeds
- ESLint restrict-plus-operands produces zero BigInt/Number mixing errors
- `npm ls ethers` shows only ethers@6.16.0 (no v5 present)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate medium-complexity files (gasManager, txManager, alphaDrop, addLiquidity)** - `78c428c` (feat)
2. **Task 2: Migrate heavy-complexity files (bot.ts, tokenSafety.ts, deploySepoliaTest.ts)** - `4f98caa` (feat)
3. **Task 3: Full project compilation verification and v5 remnant sweep** - `5a8e8cb` (fix)

## Files Created/Modified
- `src/utils/gasManager.ts` - BigNumber.from/mul/div replaced with BigInt operators, providers.JsonRpcProvider -> JsonRpcProvider
- `src/utils/txManager.ts` - @ethersproject import removed, getGasPrice -> getFeeData, BigNumber -> BigInt, providers -> JsonRpcProvider
- `src/alphaDrop.ts` - ethers.providers.JsonRpcProvider -> ethers.JsonRpcProvider
- `scripts/addLiquidity.ts` - ethers.utils.* -> ethers.*, BigNumber methods -> native BigInt, ethers.constants.Zero -> 0n
- `src/bot.ts` - ethers.providers -> ethers.JsonRpcProvider, ethers.BigNumber -> bigint, .isZero() -> === 0n, ethers.utils.* -> ethers.*, slippage calc uses native BigInt
- `src/utils/tokenSafety.ts` - providers/utils imports -> JsonRpcProvider/ethers, callStatic -> staticCall, all provider params typed as JsonRpcProvider
- `scripts/deploySepoliaTest.ts` - .deployed() -> .waitForDeployment(), .address -> getAddress(), ethers.utils.Interface -> ethers.Interface, ethers.utils.parseEther -> ethers.parseEther
- `package.json` - Added hardhat-ignition + ignition-core peer deps
- `package-lock.json` - Updated lockfile with ignition deps

## Decisions Made
- **ethers.Contract wrapper for factory calls:** In deploySepoliaTest.ts, ContractFactory.deploy() returns BaseContract which lacks custom ABI methods in v6's type system. Wrapping with `new ethers.Contract(await factory.getAddress(), abi, signer)` provides typed access to createPair().
- **BigInt wrapping for config values:** Used `BigInt(CONFIG.gasLimit || 300_000)` to safely convert potentially-number config values to bigint for v6 TransactionRequest compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript compilation errors in deploySepoliaTest.ts**
- **Found during:** Task 3 (compilation verification)
- **Issue:** Three TS errors: (1) ContractFactory.deploy() returns BaseContract without createPair method, (2-3) iface.parseLog() returns possibly null
- **Fix:** Used ethers.Contract wrapper for factory method calls; added null checks on parseLog results
- **Files modified:** scripts/deploySepoliaTest.ts
- **Verification:** `npx tsc --noEmit` exits 0 with zero errors
- **Committed in:** 5a8e8cb (Task 3 commit)

**2. [Rule 3 - Blocking] Installed missing hardhat-ignition peer dependencies**
- **Found during:** Task 3 (hardhat compile verification)
- **Issue:** hardhat-ignition-ethers requires hardhat-ignition and ignition-core as peer dependencies
- **Fix:** `npm install --save-dev @nomicfoundation/hardhat-ignition @nomicfoundation/ignition-core --legacy-peer-deps`
- **Files modified:** package.json, package-lock.json
- **Verification:** `npx hardhat compile` succeeds
- **Committed in:** 5a8e8cb (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for compilation verification. No scope creep.

## Issues Encountered
- ESLint reports many `no-unsafe-assignment`/`no-unsafe-call` warnings across source files from untyped Contract interactions -- these are pre-existing TypeScript strictness issues, not BigInt-related. Per plan instructions, only restrict-plus-operands errors are blocking (zero found). These warnings are deferred to future TypeScript strictness improvements.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all files are fully migrated with no placeholder or stub patterns.

## Next Phase Readiness
- Ethers v6 migration is 100% complete -- no v5 API patterns remain anywhere in the codebase
- Full TypeScript compilation succeeds with zero errors
- Hardhat toolbox v6 functional with all Solidity contracts
- ESLint BigInt safety guardrails active and passing
- Ready to proceed to Phase 3 (SQLite storage + code quality)

## Self-Check: PASSED

All 9 created/modified files verified on disk. All 3 task commits (78c428c, 4f98caa, 5a8e8cb) verified in git log. SUMMARY.md exists.

---
*Phase: 02-ethers-v6-migration*
*Completed: 2026-03-22*
