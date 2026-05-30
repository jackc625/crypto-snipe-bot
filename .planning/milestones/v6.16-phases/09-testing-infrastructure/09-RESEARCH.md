# Phase 9: Testing Infrastructure - Research

**Researched:** 2026-03-28
**Domain:** Vitest testing framework, SQLite test isolation, Hardhat mainnet forking, GitHub Actions CI
**Confidence:** HIGH

## Summary

Phase 9 builds a comprehensive test suite across three tiers: unit tests for safety checks and pure logic, integration tests for transaction submission and exit engine behavior, and mainnet fork tests for end-to-end snipe lifecycle validation. The project already has vitest 4.1.1 installed with 47 passing tests (API routes + fixture smoke test) and 37 todo stubs. The existing test infrastructure in `tests/` (plural) uses vitest's `describe/it/expect` pattern with `vi.mock()` for module mocking and factory-based fixtures.

The key technical challenge is structuring three distinct test tiers with different speed/isolation requirements into a single vitest configuration. Vitest 4.x has deprecated `vitest.workspace.ts` in favor of inline `projects` configuration in the root `vitest.config.ts`. The existing `vitest.config.ts` points at `tests/**/*.test.ts` and must be refactored to define three projects (unit, integration, fork) with separate include patterns, timeouts, and setup files. Coverage enforcement at 70% line coverage uses `@vitest/coverage-v8`, which must be installed as a new dependency.

**Primary recommendation:** Refactor `vitest.config.ts` to use the `test.projects` array with three inline project definitions (unit, integration, fork), install `@vitest/coverage-v8` for coverage tracking, use in-memory SQLite (`:memory:`) per test for DB isolation, use `vi.mock()` on axios and ethers Contract for safety/tx mocking, and use Hardhat Network forking via `npx hardhat node --fork` with a vitest globalSetup for fork tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** All tests live in a separate `test/` directory (not co-located in `src/`). Consistent with project convention.
- **D-02:** Tests organized by type: `test/unit/`, `test/integration/`, `test/fork/`. Enables running subsets independently.
- **D-03:** Delete the 4 existing Phase 4 test stubs (chainRegistry.test.ts, mevStrategy.test.ts, multiChainBot.test.ts, safetyProviders.test.ts) and rewrite from scratch. Code has changed significantly through Phases 5-8.
- **D-04:** Use vitest built-in `expect()` assertions (jest-compatible). Drop chai dependency for new tests.
- **D-05:** Custom shared `MockProvider` class in `test/helpers/mockProvider.ts` for blockchain interactions. Configurable to return canned responses for getAmountsOut, quoteExactInputSingle, balanceOf, etc. Reused across unit and integration tests.
- **D-06:** Use `vi.mock()` on axios for external API mocking (honeypot, GoPlus, Unicrypt, Telegram). Safety check functions run their full logic against canned API responses, including testing fallback paths when APIs fail.
- **D-07:** In-memory SQLite (`:memory:`) per test for database testing. Fresh schema applied per test for full isolation. No cleanup needed.
- **D-08:** Claude's discretion on fork tool (Hardhat network forking vs Anvil). Pick what integrates best with existing Hardhat setup.
- **D-09:** Fork targets Ethereum mainnet for TEST-05 lifecycle test.
- **D-10:** Deploy test contracts (FakeToken + Uniswap V2 pair + liquidity) on the forked network. Uses existing Hardhat contracts. Tests the actual Uniswap router code path.
- **D-11:** Full v8/istanbul coverage tracking on all `src/` files via vitest coverage reporter.
- **D-12:** Minimum enforced threshold: 70% line coverage. Test run fails below this.
- **D-13:** Dashboard React components excluded from coverage. Express API routes (src/api/routes/) ARE included.
- **D-14:** Granular npm scripts: `test:unit`, `test:integration`, `test:fork`, `test:all`, `test:coverage`. Each targets its specific test type directory.
- **D-15:** Basic GitHub Actions CI pipeline that runs `test:unit` and `test:integration` on push. Fork tests skipped in CI (require RPC access).
- **D-16:** Shared fixtures directory at `test/fixtures/` with factory functions: createMockToken(), createMockChainConfig(), mockHoneypotResponse(), etc. Extends the existing chainConfig.ts pattern.
- **D-17:** Shared `MockProvider` class at `test/helpers/mockProvider.ts` -- lightweight class configurable for canned contract call responses.
- **D-18:** Vitest workspace (`vitest.workspace.ts`) defining 3 projects: unit (fast, no network), integration (mocked APIs, mock provider), fork (Hardhat node, slow). Each with its own config, timeouts, and setup files.
- **D-19:** Claude's discretion on timeout values per test type. Fork tests need generous timeouts for contract deployment and swap execution.
- **D-20:** All 4 error path categories are equal priority -- none should be skipped.

### Claude's Discretion
- Fork tool choice (Hardhat forking vs Anvil) based on existing project setup
- Timeout values per test type (unit, integration, fork)
- Exact MockProvider API surface and configuration approach
- Coverage reporter choice (v8 vs istanbul)
- GitHub Actions workflow file structure and Node.js version matrix
- Whether to add global test setup/teardown files per workspace project
- How to handle environment variables in tests (dotenv vs inline)
- Exact vitest workspace project configuration details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Unit tests cover all 9 token safety checks including API failure fallback paths | Safety check functions in `src/utils/tokenSafety.ts` and `src/utils/safetyProviders/` can be tested by mocking axios (for API calls) and using MockProvider (for contract calls). 9 checks identified: checkHoneypot, isBlacklistedToken, isLiquidityLocked, checkTokenMetadata, simulateSwap, isLiquiditySufficient, isKnownBadToken, hasHighTransferTax, hasMaxWalletOrTxLimits. Chain-aware variants also need coverage. |
| TEST-02 | Unit tests verify SQLite storage concurrency -- concurrent writes produce correct state | better-sqlite3 `:memory:` databases provide perfect isolation. WAL mode concurrency tested by running multiple `insertTrade` calls in rapid sequence within a single test. Note: better-sqlite3 is synchronous, so "concurrent" means rapid sequential operations, not truly parallel -- but WAL mode + busy_timeout behavior can still be verified. |
| TEST-03 | Integration tests verify Flashbots bundle submission, retry with nonce increment, and fallback to direct send | MockProvider + vi.mock on FlashbotsBundleProvider. Test sendTxWithRetry with both ChainContext and legacy overloads. Verify nonce increments on retry, error propagation on max retries, and strategy dispatch (flashbots/bloxroute/passthrough). |
| TEST-04 | Integration tests verify stop-loss, take-profit, and trailing stop trigger correctly and do not double-sell | Pure computation functions (computeUrgencyMultiplier, computeEffectiveTrailingPct, getUnfilledTiers, calculatePartialSellAmount) testable as unit tests. Exit monitor integration tests mock price queries and sell execution, verify mutex prevents double-sell. Existing todo stubs in tests/exitEngine.test.ts provide the test outline. |
| TEST-05 | Mainnet fork tests simulate full snipe flow: detect pair, validate, buy, monitor, sell | Hardhat Network forking recommended (D-08 discretion). Deploy FakeToken + V2 Factory + V2 Router on fork. Create pair, add liquidity, execute buy via router, monitor price, execute sell. Requires writing Solidity contracts (currently empty 0-byte files). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.1 (installed: 4.1.1, latest: 4.1.2) | Test runner and assertion framework | Already installed, jest-compatible API, fast, native ESM+CJS support |
| @vitest/coverage-v8 | 4.1.2 | V8-based code coverage provider | Recommended by vitest, fast, accurate line/branch coverage. Matches vitest major version. |
| better-sqlite3 | ^12.8.0 (installed) | In-memory SQLite for test isolation | Already a project dependency, `:memory:` mode provides perfect per-test isolation |
| hardhat | 2.26.0 (installed) | Mainnet forking for fork tests | Already installed with toolbox, provides `hardhat node --fork` for EVM simulation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nomicfoundation/hardhat-network-helpers | ^1.1.0 (installed) | Time manipulation, impersonation | Fork tests needing mine(), time.increase(), impersonateAccount() |
| @nomicfoundation/hardhat-ethers | ^3.1.2 (installed) | Ethers v6 Hardhat integration | Fork tests deploying contracts via ethers.deployContract() |
| ethers | 6.16.0 (installed) | Blockchain interaction in fork tests | Connecting to forked Hardhat node, deploying contracts, executing swaps |
| express | ^5.2.1 (installed) | API route testing | Already used in existing API tests as test harness |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hardhat forking | Anvil (Foundry) | Anvil is faster but not installed and would require Rust toolchain; Hardhat already configured with contracts and ethers v6 plugin |
| @vitest/coverage-v8 | @vitest/coverage-istanbul | istanbul is more established but v8 is faster and recommended by vitest team; both produce equivalent reports |
| vitest.workspace.ts (D-18) | test.projects in vitest.config.ts | workspace files deprecated in vitest 3.2+; use projects array instead (functionally identical) |

**Installation:**
```bash
npm install --save-dev @vitest/coverage-v8@^4.1.2 --legacy-peer-deps
```

Note: `--legacy-peer-deps` required due to @flashbots/ethers-provider-bundle peer dep conflict (established in Phase 02/07).

## Architecture Patterns

### Recommended Project Structure
```
test/
  unit/
    tokenSafety.test.ts        # TEST-01: 9 safety checks + fallbacks
    safetyProviders.test.ts     # TEST-01: chain-aware safety dispatch
    db.test.ts                  # TEST-02: SQLite concurrency + schema
    exitEngine.test.ts          # TEST-04: pure computation functions
    riskManager.test.ts         # Risk gate checks
    chainRegistry.test.ts       # Chain config building + validation
  integration/
    txManager.test.ts           # TEST-03: Flashbots bundle, retry, fallback
    exitMonitor.test.ts         # TEST-04: exit triggers, mutex, no double-sell
    mevStrategies.test.ts       # TEST-03: strategy dispatch (flashbots/blox/pass)
  fork/
    snipeLifecycle.test.ts      # TEST-05: full snipe flow on forked mainnet
    setup.ts                    # Fork test globalSetup: start Hardhat node
    teardown.ts                 # Fork test globalTeardown: stop Hardhat node
  helpers/
    mockProvider.ts             # Shared MockProvider class (D-05/D-17)
    testDb.ts                   # In-memory DB factory with schema migration
  fixtures/
    chainConfig.ts              # EXISTING: mock chain configs (to be updated)
    api.fixtures.ts             # EXISTING: API test fixtures (move from tests/)
    exitEngine.fixtures.ts      # EXISTING: exit engine fixtures (move from tests/)
    tokenSafety.fixtures.ts     # NEW: canned API responses, token addresses
    txManager.fixtures.ts       # NEW: mock tx requests, bundle responses
contracts/
    FakeToken.sol               # EMPTY: needs ERC20 implementation for fork tests
    UniswapV2Factory.sol        # EMPTY: needs interface for fork test pair creation
    UniswapV2Router02.sol       # EMPTY: needs interface for fork test swaps
```

**CRITICAL NOTE: Directory naming.** CONTEXT.md says `test/` (singular) but existing tests live in `tests/` (plural) at `tests/exitEngine.test.ts`, `tests/api/*.test.ts`, `tests/fixtures/`. The existing `vitest.config.ts` points to `tests/**/*.test.ts`. The Phase 4 stubs live in `test/` (singular). The planner must reconcile this -- recommendation: use `test/` (singular) per D-01, move existing `tests/` content into the new structure, delete `tests/` directory.

### Pattern 1: Vitest Projects Configuration (replacing deprecated workspace)

**What:** D-18 specifies `vitest.workspace.ts` but this file format is deprecated since vitest 3.2. Use `test.projects` in `vitest.config.ts` instead (functionally identical).

**When to use:** Always -- this is the modern vitest 4.x approach.

**Example:**
```typescript
// vitest.config.ts -- replaces both existing vitest.config.ts and planned vitest.workspace.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                    testTimeout: 5000,
                    environment: 'node',
                    mockReset: true,
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.test.ts'],
                    testTimeout: 15000,
                    environment: 'node',
                    mockReset: true,
                },
            },
            {
                extends: true,
                test: {
                    name: 'fork',
                    include: ['test/fork/**/*.test.ts'],
                    testTimeout: 120000,
                    environment: 'node',
                    globalSetup: ['test/fork/setup.ts'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/dashboard/**',
                'src/**/*.d.ts',
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
            reporter: ['text', 'html', 'json-summary'],
            reportsDirectory: './coverage',
        },
    },
});
```
Source: [Vitest Test Projects docs](https://vitest.dev/guide/projects), [Vitest Coverage docs](https://vitest.dev/config/coverage)

### Pattern 2: In-Memory SQLite Test Factory

**What:** Create isolated DB instances per test with full schema migration applied.
**When to use:** Any test touching database (TEST-02, integration tests).

**Example:**
```typescript
// test/helpers/testDb.ts
import Database from 'better-sqlite3';

/**
 * Creates a fresh in-memory SQLite database with the full schema applied.
 * Each test gets its own isolated DB instance -- no cleanup needed.
 */
export function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');

    // Apply schema v1: trades table
    db.exec(`
        CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'mainnet',
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'partial_sell', 'fail')),
            tx_hash TEXT,
            block INTEGER,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
            amount_in TEXT,
            amount_out TEXT,
            gas_cost TEXT,
            price_at_action TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed')),
            pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3')),
            fee_tier INTEGER
        );
        CREATE INDEX idx_trades_token ON trades(token);
        CREATE INDEX idx_trades_chain ON trades(chain);
        CREATE INDEX idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX idx_trades_status ON trades(status);
    `);

    // Apply schema v3: exit_state table
    db.exec(`
        CREATE TABLE exit_state (
            trade_id INTEGER PRIMARY KEY,
            entry_price REAL NOT NULL,
            high_water_mark REAL NOT NULL,
            trailing_activated INTEGER NOT NULL DEFAULT 0,
            partial_tiers_completed TEXT NOT NULL DEFAULT '[]',
            original_token_amount TEXT NOT NULL,
            urgency_start_ts INTEGER NOT NULL,
            volatility_samples TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX idx_exit_state_trade ON exit_state(trade_id);
    `);

    db.pragma('user_version = 3');
    return db;
}
```

### Pattern 3: MockProvider for Contract Calls

**What:** Lightweight configurable mock that replaces ethers JsonRpcProvider/Contract for tests.
**When to use:** Unit and integration tests that call contract methods (getAmountsOut, balanceOf, etc.).

**Example:**
```typescript
// test/helpers/mockProvider.ts
import { vi } from 'vitest';

interface ContractCallConfig {
    [methodName: string]: (...args: any[]) => any;
}

/**
 * Creates a mock provider that returns canned responses for contract calls.
 * Usage: configure method responses, then pass as ctx.httpProvider in tests.
 */
export function createMockProvider(overrides: Record<string, any> = {}) {
    return {
        getCode: vi.fn().mockResolvedValue('0x60806040...'),
        getBlockNumber: vi.fn().mockResolvedValue(18000000),
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
        getFeeData: vi.fn().mockResolvedValue({ gasPrice: 30000000000n }),
        ...overrides,
    };
}

/**
 * Creates a mock ethers Contract that dispatches method calls to configured handlers.
 * Supports both direct calls and .staticCall variants.
 */
export function createMockContract(methods: ContractCallConfig = {}) {
    const contract: any = {};
    for (const [name, handler] of Object.entries(methods)) {
        contract[name] = vi.fn(handler);
        // ethers v6 staticCall pattern
        if (!contract.staticCall) contract.staticCall = {};
        contract[name].staticCall = vi.fn(handler);
    }
    // Interface for encodeFunctionData (used in exit engine sell builders)
    contract.interface = {
        encodeFunctionData: vi.fn().mockReturnValue('0xmockdata'),
    };
    return contract;
}
```

### Pattern 4: Mocking Module Dependencies with vi.mock()

**What:** Use vitest's `vi.mock()` to replace heavy dependencies (axios, db, flashbots) with test doubles.
**When to use:** Any test that imports modules with side effects (DB initialization, network calls).

**Example:**
```typescript
// Mocking the DB module (prevents real file system access)
vi.mock('../../src/utils/db', () => {
    const db = createTestDb();  // from test/helpers/testDb.ts
    const insertTrade = db.prepare(`INSERT INTO trades (...) VALUES (...)`);
    return {
        db,
        insertTrade,
        getTradesByToken: db.prepare(`SELECT * FROM trades WHERE token = ?`),
        // ... other prepared statements
    };
});

// Mocking axios (prevents real API calls)
vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));
```

### Pattern 5: Fork Test with Hardhat Node

**What:** Start Hardhat node with mainnet forking in globalSetup, connect ethers to it.
**When to use:** TEST-05 fork tests only.

**Example:**
```typescript
// test/fork/setup.ts
import { execSync, spawn } from 'child_process';

let hardhatProcess: ReturnType<typeof spawn>;

export async function setup() {
    // Start Hardhat node with mainnet forking
    hardhatProcess = spawn('npx', ['hardhat', 'node', '--fork', process.env.ETH_RPC_URL!], {
        stdio: 'pipe',
        shell: true,
    });

    // Wait for node to be ready
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Hardhat node startup timeout')), 30000);
        hardhatProcess.stdout?.on('data', (data: Buffer) => {
            if (data.toString().includes('Started HTTP')) {
                clearTimeout(timeout);
                resolve();
            }
        });
    });
}

export async function teardown() {
    hardhatProcess?.kill();
}
```

### Anti-Patterns to Avoid
- **Importing src/utils/db.ts directly in tests:** The module runs side-effect code on import (creates DB file, runs migrations). Always mock it or use the testDb helper.
- **Using chai assertions in new tests:** D-04 mandates vitest's `expect()`. The existing Phase 4 stubs use chai -- they are being deleted.
- **Testing against real APIs:** All external API calls (honeypot.is, GoPlus, Unicrypt, Telegram) must be mocked. Tests should never make network requests except fork tests.
- **Shared mutable state between tests:** Each test should get a fresh DB instance and fresh mocks. Use `beforeEach` + `vi.restoreAllMocks()`.
- **Running fork tests in CI without RPC access:** Fork tests require an Ethereum archive node RPC URL. CI runs unit + integration only (D-15).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coverage tracking | Custom line counter | @vitest/coverage-v8 | Handles source maps, branch coverage, thresholds, reporting |
| In-memory SQLite | Custom mock DB | better-sqlite3 `:memory:` | Real SQLite engine, schema validation, transaction support |
| Mainnet forking | Custom EVM simulator | Hardhat Network forking | Full EVM state, real Uniswap contracts, impersonation |
| HTTP server testing | Custom request client | Node http module (already used) | Pattern established in Phase 8 API tests, no supertest needed |
| Mock framework | Custom spy/stub library | vitest vi.mock()/vi.fn()/vi.spyOn() | Built-in, jest-compatible, hoisting support |

**Key insight:** The project already has most required infrastructure installed. The main work is organizing tests into the three-tier structure and writing the actual test cases, not installing new tools.

## Common Pitfalls

### Pitfall 1: DB Module Side Effects on Import
**What goes wrong:** Importing `src/utils/db.ts` in a test creates a real SQLite file on disk and runs migrations against it. This causes test pollution and filesystem side effects.
**Why it happens:** `db.ts` executes `new Database(DB_PATH)` and `migrateSchema()` at module load time (top-level side effects).
**How to avoid:** Always `vi.mock('../../src/utils/db')` before importing any module that depends on it. Use dynamic `await import()` after mocks are set up (pattern already used in existing tests like health.test.ts).
**Warning signs:** Tests creating `data/bot.db` files, tests failing due to schema conflicts.

### Pitfall 2: vitest.workspace.ts is Deprecated
**What goes wrong:** Creating `vitest.workspace.ts` as specified in D-18 will trigger deprecation warnings in vitest 4.x and may be removed in a future major version.
**Why it happens:** vitest 3.2 deprecated workspace files in favor of the `test.projects` array in the root config.
**How to avoid:** Use `test.projects` in `vitest.config.ts` instead. Functionally identical to workspace, just different syntax.
**Warning signs:** Console warnings about deprecated workspace configuration on test runs.

### Pitfall 3: Config Module Circular Dependencies in Tests
**What goes wrong:** `src/config.ts` imports `logger.ts`, reads process.env at module load, and validates required env vars. Importing it in tests triggers validation errors.
**Why it happens:** Missing PRIVATE_KEY, ALCHEMY_URL etc. in test environment.
**How to avoid:** Mock `src/config.ts` or set minimal env vars in test setup. For unit tests testing pure functions, avoid importing config at all.
**Warning signs:** Tests failing with "Missing required environment variable" errors.

### Pitfall 4: Empty Contract Files
**What goes wrong:** Fork tests referencing FakeToken.sol, UniswapV2Factory.sol, UniswapV2Router02.sol will fail because these files are 0 bytes (empty).
**Why it happens:** The contracts were created as placeholders but never populated.
**How to avoid:** Write actual Solidity contract code before fork tests. FakeToken needs basic ERC20. Factory/Router need the Uniswap V2 interface (can import from npm or write minimal versions).
**Warning signs:** Hardhat compilation failing with empty contract errors.

### Pitfall 5: test/ vs tests/ Directory Confusion
**What goes wrong:** Existing Phase 7/8 tests are in `tests/` (plural). Phase 4 stubs are in `test/` (singular). D-01 specifies `test/` (singular). The existing vitest.config.ts points to `tests/`.
**Why it happens:** Different phases used different conventions.
**How to avoid:** Consolidate everything into `test/` (singular) per D-01. Move existing `tests/` content (api tests, exit engine test, fixtures) into the new `test/` structure. Delete `tests/` directory. Update vitest.config.ts.
**Warning signs:** Tests not found by vitest, duplicate test files.

### Pitfall 6: --legacy-peer-deps Required for npm Install
**What goes wrong:** `npm install @vitest/coverage-v8` fails with peer dependency conflict from @flashbots/ethers-provider-bundle.
**Why it happens:** Flashbots package pins ethers 6.7.1 as peer dep, but project uses 6.16.0.
**How to avoid:** Always use `--legacy-peer-deps` flag for any npm install (established in Phase 02).
**Warning signs:** ERESOLVE errors during npm install.

### Pitfall 7: Fork Test Timeout
**What goes wrong:** Fork tests time out because starting a Hardhat node, deploying contracts, and executing swaps takes 30-60+ seconds.
**Why it happens:** Default vitest timeout is 5-10 seconds.
**How to avoid:** Set generous timeouts for fork project: 120000ms (2 minutes) per test. Use globalSetup to pre-start the node.
**Warning signs:** Tests timing out despite correct logic.

### Pitfall 8: Pino Logger Noise in Test Output
**What goes wrong:** Tests produce excessive JSON log output from pino logger, making test results hard to read.
**Why it happens:** Production modules use `logger.child()` which outputs to stdout.
**How to avoid:** Mock the logger module in test setup or set LOG_LEVEL=silent in test environment.
**Warning signs:** Verbose JSON lines mixed with test assertions.

## Code Examples

### Example 1: Safety Check Unit Test with API Fallback

```typescript
// test/unit/tokenSafety.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock dependencies before importing the module under test
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../../src/config', () => ({
    CONFIG: {
        honeypotCheckURL: 'https://api.honeypot.is/v2/IsHoneypot?address=',
        routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        snipeAmountETH: '0.01',
        walletPrivateKey: '0x' + '1'.repeat(64),
    },
}));
vi.mock('../../src/utils/provider', () => ({
    getProvider: vi.fn(() => createMockProvider()),
}));
// Mock ethers Contract constructor
vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers');
    return {
        ...actual,
        Contract: vi.fn(() => createMockContract({
            swapExactETHForTokens: { staticCall: vi.fn().mockResolvedValue([0n, 1000n]) },
        })),
    };
});

import { createMockProvider } from '../helpers/mockProvider';
import { createMockContract } from '../helpers/mockProvider';

describe('checkHoneypot', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('returns false when API says not honeypot', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { isHoneypot: false } });
        const { checkHoneypot } = await import('../../src/utils/tokenSafety');
        const result = await checkHoneypot('0xtoken');
        expect(result).toBe(false);
    });

    it('falls back to static call when API fails', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('API timeout'));
        const { checkHoneypot } = await import('../../src/utils/tokenSafety');
        const result = await checkHoneypot('0xtoken');
        // staticCall succeeds -> not a honeypot
        expect(result).toBe(false);
    });
});
```
Source: Vitest mocking docs, project pattern from tests/api/health.test.ts

### Example 2: SQLite Concurrency Test

```typescript
// test/unit/db.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../helpers/testDb';

describe('TEST-02: SQLite concurrent writes', () => {
    it('handles rapid sequential inserts without data loss', () => {
        const db = createTestDb();
        const insert = db.prepare(
            `INSERT INTO trades (token, chain, action, status, amount_in)
             VALUES (?, 'eth', 'buy', 'pending', '0.01')`
        );

        const tokens = Array.from({ length: 100 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
        for (const token of tokens) {
            insert.run(token);
        }

        const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
        expect(count.c).toBe(100);
        db.close();
    });

    it('transaction rollback preserves consistency', () => {
        const db = createTestDb();
        const insert = db.prepare(
            `INSERT INTO trades (token, chain, action, status) VALUES (?, 'eth', 'buy', 'pending')`
        );

        // Successful transaction
        db.transaction(() => {
            insert.run('0x111');
            insert.run('0x222');
        })();

        // Failed transaction (violate CHECK constraint)
        try {
            db.transaction(() => {
                insert.run('0x333');
                db.prepare(`INSERT INTO trades (token, chain, action, status) VALUES (?, 'eth', 'INVALID', 'pending')`).run('0x444');
            })();
        } catch { /* expected */ }

        const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
        expect(count.c).toBe(2); // Only the successful transaction committed
        db.close();
    });
});
```

### Example 3: Exit Engine Double-Sell Prevention

```typescript
// test/integration/exitMonitor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/db', () => ({ /* mock DB */ }));
vi.mock('../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

describe('TEST-04: No double-sell', () => {
    it('mutex prevents concurrent sell triggers', () => {
        const { tryAcquireSellLock, releaseSellLock } = require('../../src/utils/exitManager');

        // First acquire succeeds
        expect(tryAcquireSellLock('eth', '0xtoken')).toBe(true);

        // Second acquire for same token fails (sell in progress)
        expect(tryAcquireSellLock('eth', '0xtoken')).toBe(false);

        // After release, can acquire again
        releaseSellLock('eth', '0xtoken');
        expect(tryAcquireSellLock('eth', '0xtoken')).toBe(true);

        releaseSellLock('eth', '0xtoken');
    });

    it('different chains do not block each other', () => {
        const { tryAcquireSellLock, releaseSellLock } = require('../../src/utils/exitManager');

        expect(tryAcquireSellLock('eth', '0xtoken')).toBe(true);
        expect(tryAcquireSellLock('bsc', '0xtoken')).toBe(true); // Different chain, same token

        releaseSellLock('eth', '0xtoken');
        releaseSellLock('bsc', '0xtoken');
    });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| vitest.workspace.ts | test.projects in vitest.config.ts | vitest 3.2 (2025) | D-18 specifies workspace file but projects array is the modern replacement; functionally identical |
| chai assertions | vitest expect() (jest-compatible) | vitest adoption | D-04 already decided this; existing Phase 4 stubs use chai and will be deleted |
| Separate coverage package | @vitest/coverage-v8 built-in integration | vitest 1.0+ | Install as peer, configure in root config, not per-project |
| @nomiclabs/hardhat-ethers (v5) | @nomicfoundation/hardhat-ethers (v6) | Project Phase 2 | Already upgraded in this project |

**Deprecated/outdated:**
- `vitest.workspace.ts`: Deprecated in vitest 3.2, replaced by `test.projects`
- `chai` for assertions: Still works but D-04 mandates vitest `expect()`
- `@nomiclabs/hardhat-ethers`: Replaced by `@nomicfoundation/hardhat-ethers` (already done)

## Open Questions

1. **Solidity Contract Contents**
   - What we know: FakeToken.sol, UniswapV2Factory.sol, UniswapV2Router02.sol exist but are 0 bytes
   - What's unclear: Whether to write minimal ERC20/factory/router implementations or import from npm packages (@uniswap/v2-core, @uniswap/v2-periphery)
   - Recommendation: Write a minimal FakeToken (ERC20 with mint function). For factory/router, import Uniswap V2 contract artifacts or use Hardhat's mainnet forking to interact with already-deployed Uniswap contracts at their real addresses. The latter approach is simpler for fork tests since the contracts already exist on mainnet.

2. **Config Module Mocking Strategy**
   - What we know: `src/config.ts` validates required env vars at import time, causing test failures
   - What's unclear: Best approach for tests that need CONFIG values but can't provide real env vars
   - Recommendation: Use `vi.mock('../../src/config', ...)` with canned CONFIG values. Set `PRIVATE_KEY` and `ALCHEMY_URL` to dummy values in a shared test setup file to prevent validation errors when config is dynamically imported.

3. **Existing tests/ Directory Migration**
   - What we know: 47 passing tests in `tests/` (plural), 4 stubs in `test/` (singular), D-01 says `test/`
   - What's unclear: Whether to migrate existing `tests/` content or rename the directory
   - Recommendation: Move all `tests/` content into the new `test/` structure. API tests go to `test/integration/api/`. Exit engine tests go to `test/unit/exitEngine.test.ts`. Fixtures move to `test/fixtures/`. Delete `tests/` after migration.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tests | Yes | 22.16.0 | -- |
| npm | Package install | Yes | 9.9.4 | -- |
| vitest | Test runner | Yes | 4.1.1 | -- |
| Hardhat | Fork tests | Yes | 2.26.0 | -- |
| better-sqlite3 | DB tests | Yes | ^12.8.0 | -- |
| @vitest/coverage-v8 | Coverage | No | -- | Install: `npm install --save-dev @vitest/coverage-v8@^4.1.2 --legacy-peer-deps` |
| Ethereum RPC URL | Fork tests | Conditional | -- | Skip fork tests if ETH_RPC_URL not set (CI behavior per D-15) |
| GitHub Actions | CI | N/A (remote) | -- | Local testing works without CI |

**Missing dependencies with no fallback:**
- None -- all blockers have installation paths

**Missing dependencies with fallback:**
- `@vitest/coverage-v8`: Not installed yet, must be added (simple npm install)
- Ethereum RPC URL for fork tests: Skip fork tests in CI per D-15; require for local fork test runs

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | `vitest.config.ts` (exists, needs refactoring for projects) |
| Quick run command | `npx vitest run --project unit` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | 9 safety checks + fallback paths | unit | `npx vitest run --project unit test/unit/tokenSafety.test.ts -x` | No -- Wave 0 |
| TEST-02 | SQLite concurrent writes | unit | `npx vitest run --project unit test/unit/db.test.ts -x` | No -- Wave 0 |
| TEST-03 | Flashbots bundle, retry, fallback | integration | `npx vitest run --project integration test/integration/txManager.test.ts -x` | No -- Wave 0 |
| TEST-04 | Stop-loss, take-profit, trailing, no double-sell | unit+integration | `npx vitest run --project unit test/unit/exitEngine.test.ts -x` | Partial (todo stubs in tests/) |
| TEST-05 | Full snipe lifecycle on mainnet fork | fork | `npx vitest run --project fork test/fork/snipeLifecycle.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit` (fast, <5s)
- **Per wave merge:** `npx vitest run` (all projects)
- **Phase gate:** Full suite green + coverage >= 70% before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/tokenSafety.test.ts` -- covers TEST-01
- [ ] `test/unit/db.test.ts` -- covers TEST-02
- [ ] `test/integration/txManager.test.ts` -- covers TEST-03
- [ ] `test/unit/exitEngine.test.ts` -- covers TEST-04 (pure functions)
- [ ] `test/integration/exitMonitor.test.ts` -- covers TEST-04 (mutex, triggers)
- [ ] `test/fork/snipeLifecycle.test.ts` -- covers TEST-05
- [ ] `test/helpers/mockProvider.ts` -- shared mock infrastructure
- [ ] `test/helpers/testDb.ts` -- shared DB factory
- [ ] `@vitest/coverage-v8` -- install: `npm install --save-dev @vitest/coverage-v8@^4.1.2 --legacy-peer-deps`
- [ ] `vitest.config.ts` -- refactor to use `test.projects` array
- [ ] `contracts/FakeToken.sol` -- write minimal ERC20 for fork tests
- [ ] `.github/workflows/test.yml` -- CI pipeline

## Project Constraints (from CLAUDE.md)

- **RTK prefix:** All bash commands must use `rtk` prefix (e.g., `rtk npm install`, `rtk npx vitest run`)
- **Bot start command:** `npx ts-node src/bot.ts` is the entry point (not relevant to testing but noted for context)
- **--legacy-peer-deps:** Required for all npm installs due to flashbots peer dep conflict

## Discretion Recommendations

Based on research, here are recommendations for Claude's Discretion areas:

| Area | Recommendation | Rationale |
|------|----------------|-----------|
| Fork tool | Hardhat Network forking | Already installed (2.26.0), ethers v6 plugin configured, has mainnet forking support, no additional toolchain needed |
| Timeouts | Unit: 5s, Integration: 15s, Fork: 120s | Unit tests are pure/mocked (fast). Integration has mocked I/O (moderate). Fork deploys contracts + executes swaps (slow). |
| MockProvider API | Class with configurable method responses via constructor + vi.fn() | Matches existing api.fixtures.ts pattern. Simple object with vi.fn() mocks is more flexible than class inheritance. |
| Coverage reporter | v8 | Faster than istanbul, recommended by vitest, native V8 coverage engine |
| GitHub Actions | Single workflow file, Node 22.x, ubuntu-latest | Project uses Node 22.16.0 locally. Single file simpler than matrix. |
| Global setup/teardown | Yes for fork project only | Fork needs Hardhat node lifecycle. Unit/integration don't need global setup. |
| Env vars in tests | Inline in vi.mock() + shared setup file | Cleaner than dotenv, no .env.test file to maintain. Set minimal vars in per-project setup. |
| Projects config | `test.projects` in vitest.config.ts | Replaces deprecated vitest.workspace.ts. Functionally identical per vitest 4.x docs. |

## Sources

### Primary (HIGH confidence)
- [Vitest Test Projects](https://vitest.dev/guide/projects) - Projects configuration syntax, deprecation of workspace
- [Vitest Coverage Config](https://vitest.dev/config/coverage) - v8 provider, thresholds, include/exclude
- [Hardhat Network Reference](https://v2.hardhat.org/hardhat-network/docs/reference) - hardhat_reset, forking configuration
- npm registry: vitest 4.1.2, @vitest/coverage-v8 4.1.2, better-sqlite3 12.8.0 (verified via `npm view`)
- Project codebase: vitest.config.ts, package.json, test files (direct file reads)

### Secondary (MEDIUM confidence)
- [Hardhat Forking Guide](https://www.quicknode.com/guides/ethereum-development/smart-contracts/how-to-fork-ethereum-mainnet-with-hardhat) - Fork test patterns
- [GitHub Actions Node.js](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing/building-and-testing-nodejs) - CI workflow structure
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) - :memory: database pattern

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages verified against npm registry, versions confirmed, vitest already installed
- Architecture: HIGH - Projects configuration verified against official vitest docs, patterns validated against existing codebase tests
- Pitfalls: HIGH - Discovered through direct codebase analysis (empty contracts, dual test directories, module side effects)

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (30 days -- stable ecosystem, vitest 4.x settled)
