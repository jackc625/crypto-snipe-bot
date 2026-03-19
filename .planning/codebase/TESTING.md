# Testing Patterns

**Analysis Date:** 2026-03-19

## Test Framework

**Status:** No testing framework configured

**Context:**
- Empty `test/` directory exists but contains no test files
- `package.json` lists dev dependencies for Hardhat testing ecosystem:
  - `chai` 4.3.10 - Assertion library
  - `ethereum-waffle` 3.4.4 - Smart contract testing
  - `@types/mocha` ^10.0.10 - Mocha test types
  - `@nomicfoundation/hardhat-chai-matchers` ^1.0.6 - Enhanced chai matchers
- **No test runner configured** - no mocha.config.js, jest.config.js, or vitest.config.ts
- **No test scripts defined** - `package.json` contains only `"build": "tsc"` script

## Test File Organization

**Current State:**
- Test directory exists but is empty: `/test/` (0 bytes)
- No test files in source tree (no `*.test.ts`, `*.spec.ts` files found in `src/`)
- Solidity contracts exist without corresponding test suites:
  - `contracts/FakeToken.sol`
  - `contracts/UniswapV2Factory.sol`
  - `contracts/UniswapV2Router02.sol`

**Recommendation for Adding Tests:**
- **Location:** Create test files co-located with source code: `src/**/*.test.ts` or separate `test/` directory
- **Naming:** Use `*.test.ts` or `*.spec.ts` suffix for consistency
- **Structure:** Match directory structure in `src/` for utility tests

## Test Types

**Unit Tests (Not Implemented):**
- Should test utility functions in isolation:
  - `src/utils/retry.ts` - Generic retry logic with exponential backoff
  - `src/utils/gasManager.ts` - Gas price calculation
  - `src/utils/storage.ts` - State persistence
  - `src/utils/logger.ts` - Timestamp formatting

**Integration Tests (Not Implemented):**
- Should test multi-component workflows:
  - Token safety checks in `src/utils/tokenSafety.ts` (API calls + fallback logic)
  - Transaction sending with Flashbots in `src/utils/txManager.ts`
  - Bot pair handling in `src/bot.ts` - handleNewPair orchestration

**Smart Contract Tests (Partially Setup):**
- Hardhat + Chai/Waffle configured but no test files present
- Should test Solidity contracts:
  - `contracts/FakeToken.sol`
  - `contracts/UniswapV2Factory.sol`
  - `contracts/UniswapV2Router02.sol`

**End-to-End Tests (Not Implemented):**
- Should test Telegram listening and message parsing in `src/telegramListener.ts`
- Should test alpha drop handling flow in `src/alphaDrop.ts`

## Mocking Strategy

**No Mocking Framework Configured**

**Current Patterns Observed in Code:**
- Manual mock setup via try-catch fallbacks (see `src/utils/tokenSafety.ts`):
  - Lines 36-61: Honeypot API call with fallback to static call simulation
  - Lines 73-92: Unicrypt API with fallback to burn check

**Recommended Approach for Future Tests:**
- Use Jest (no setup required, single dependency) or Vitest for fast unit tests
- Mock external APIs:
  - `axios` calls to honeypot API, Unicrypt API, Telegram API
  - ethers.js provider calls
- Mock Flashbots provider for transaction testing
- Consider using ethers test utilities for contract interaction testing

## Error Handling in Tests

**Current Code Patterns (Testable):**
- Try-catch with fallback in `src/utils/tokenSafety.ts` lines 36-61:
  ```typescript
  try {
      // Try primary API check
      const { data } = await retry(() =>
          axios.get(`${CONFIG.honeypotCheckURL}${tokenAddress}`)
      );
      return data.isHoneypot;
  } catch (apiErr: unknown) {
      // Type-safe error handling
      const message = (apiErr instanceof Error) ? apiErr.message : String(apiErr);
      console.warn(`⚠️ Honeypot API failed: ${message}`);
      // Fallback to static call
      try {
          await router.callStatic.swapExactETHForTokens(...);
          return false;
      } catch (e: unknown) {
          const fallbackMessage = (e instanceof Error) ? e.message : String(e);
          console.warn("🚨 Honeypot fallback failed — likely a honeypot:", fallbackMessage);
          return true;
      }
  }
  ```

**Error Testing Guidelines:**
- Test both happy path and error paths
- Verify fallback mechanisms trigger correctly
- Validate error messages are informative
- Ensure errors don't prevent state updates

## Fixtures and Test Data

**No Test Fixtures Configured**

**Hardcoded Test Data in Source Code:**
- Blocklist initialized in `src/utils/blocklist.ts`:
  ```typescript
  export const BLOCKLIST = {
      tokens: new Set<string>([...]),
      creators: new Set<string>([...]),
      pairs: new Set<string>([...])
  };
  ```
- Config loaded from environment in `src/config.ts`
- Addresses loaded from `src/addresses.json`

**Recommendation for Test Fixtures:**
- Create `test/fixtures/` directory for:
  - Mock token addresses
  - Mock pair addresses
  - Mock API responses (Honeypot, Unicrypt)
  - Test blockchain state
- Use factory functions for creating test data:
  ```typescript
  // Example factory pattern to implement
  function createMockToken(overrides?: Partial<Token>): Token {
      return { address: "0x...", symbol: "TEST", ...overrides };
  }
  ```

## State Management Testing

**Current State Mechanism (see `src/utils/storage.ts`):**
- In-memory state persisted to `.bot-state.json`
- Type-safe state structure:
  ```typescript
  type State = {
      sniped: Record<string, {
          txHash: string;
          timestamp: number;
          status: "pending" | "sold" | "failed";
      }>;
  };
  ```

**Testing Recommendations:**
- Test state persistence: verify data written to disk
- Test concurrent updates: handle multiple tokens sniped simultaneously
- Test state recovery on restart
- Mock file system for unit tests, use real filesystem for integration tests

## Coverage

**Current Status:** No coverage tracking configured

**Tools to Add:**
- Istanbul (built into Jest)
- nyc for standalone coverage with Mocha
- Hardhat's built-in coverage for Solidity: `hardhat coverage`

**Target Coverage Gaps:**
High priority test areas:
- `src/utils/tokenSafety.ts` (350 lines) - Multiple validation checks with network calls
- `src/bot.ts` (353 lines) - Core sniping logic, transaction handling, monitoring loops
- `src/utils/txManager.ts` (79 lines) - Flashbots bundle sending and retry logic

**View Coverage (When Implemented):**
```bash
# For TypeScript/JavaScript tests
npm run test:coverage

# For Solidity contracts
npx hardhat coverage
```

## Test Execution

**Current Status:** No test execution configured

**Recommended Setup:**

Install test framework:
```bash
npm install --save-dev jest @types/jest ts-jest
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

Create `jest.config.js`:
```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/?(*.)+(spec|test).ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"]
};
```

## Testing Anti-Patterns to Avoid

Based on code structure:

1. **Don't test with real API calls** - All Honeypot API, Unicrypt API, Telegram API calls should be mocked
2. **Don't test with real blockchain** - Use ethers mock provider or Hardhat test network
3. **Don't skip error cases** - Fallback paths in `tokenSafety.ts` are critical to test
4. **Don't ignore type safety** - Tests should be TypeScript, not JavaScript
5. **Don't test state directly** - Test through public functions (`markSniped()`, `isAlreadySniped()`)

## Critical Test Paths

**Must-Test Functions:**

1. **Retry Logic** (`src/utils/retry.ts`):
   - Test successful operation on first attempt
   - Test failure with exponential backoff
   - Test max retries exceeded
   - Verify delay calculations: `delay * backoffFactor ** (attempt - 1)`

2. **Token Safety** (`src/utils/tokenSafety.ts`):
   - Test honeypot detection via API
   - Test honeypot detection via static call fallback
   - Test blacklist function detection via bytecode inspection
   - Test liquidity lock check (Unicrypt API + burn fallback)
   - Test transfer tax detection

3. **Transaction Manager** (`src/utils/txManager.ts`):
   - Test Flashbots bundle submission
   - Test fallback to direct transaction sending
   - Test retry on bundle rejection
   - Test proper nonce handling

4. **Bot Pair Handling** (`src/bot.ts`, `handleNewPair` function):
   - Test all safety checks pass → token is purchased
   - Test any safety check fails → token is skipped
   - Test already-sniped detection
   - Test blocklist checks
   - Test stop-loss monitoring interval setup
   - Test take-profit monitoring interval setup
   - Test timed sell scheduling

---

*Testing analysis: 2026-03-19*
