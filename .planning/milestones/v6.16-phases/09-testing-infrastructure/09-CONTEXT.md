# Phase 9: Testing Infrastructure - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Comprehensive test suite validating the safety pipeline, storage layer, execution engine, and full snipe lifecycle. Covers unit tests, integration tests, and mainnet fork tests as specified in TEST-01 through TEST-05. Also includes coverage tracking infrastructure, CI pipeline, and shared test utilities. No new bot features, no dashboard frontend tests, no runtime behavior changes.

</domain>

<decisions>
## Implementation Decisions

### Test organization & structure
- **D-01:** All tests live in a separate `test/` directory (not co-located in `src/`). Consistent with project convention.
- **D-02:** Tests organized by type: `test/unit/`, `test/integration/`, `test/fork/`. Enables running subsets independently.
- **D-03:** Delete the 4 existing Phase 4 test stubs (chainRegistry.test.ts, mevStrategy.test.ts, multiChainBot.test.ts, safetyProviders.test.ts) and rewrite from scratch. Code has changed significantly through Phases 5-8.
- **D-04:** Use vitest built-in `expect()` assertions (jest-compatible). Drop chai dependency for new tests.

### Mocking strategy
- **D-05:** Custom shared `MockProvider` class in `test/helpers/mockProvider.ts` for blockchain interactions. Configurable to return canned responses for getAmountsOut, quoteExactInputSingle, balanceOf, etc. Reused across unit and integration tests.
- **D-06:** Use `vi.mock()` on axios for external API mocking (honeypot, GoPlus, Unicrypt, Telegram). Safety check functions run their full logic against canned API responses, including testing fallback paths when APIs fail.
- **D-07:** In-memory SQLite (`:memory:`) per test for database testing. Fresh schema applied per test for full isolation. No cleanup needed.

### Mainnet fork tests
- **D-08:** Claude's discretion on fork tool (Hardhat network forking vs Anvil). Pick what integrates best with existing Hardhat setup.
- **D-09:** Fork targets Ethereum mainnet for TEST-05 lifecycle test.
- **D-10:** Deploy test contracts (FakeToken + Uniswap V2 pair + liquidity) on the forked network. Uses existing Hardhat contracts. Tests the actual Uniswap router code path.

### Coverage & scope
- **D-11:** Full v8/istanbul coverage tracking on all `src/` files via vitest coverage reporter.
- **D-12:** Minimum enforced threshold: 70% line coverage. Test run fails below this.
- **D-13:** Dashboard React components excluded from coverage. Express API routes (src/api/routes/) ARE included.

### Test scripts & CI
- **D-14:** Granular npm scripts: `test:unit`, `test:integration`, `test:fork`, `test:all`, `test:coverage`. Each targets its specific test type directory.
- **D-15:** Basic GitHub Actions CI pipeline that runs `test:unit` and `test:integration` on push. Fork tests skipped in CI (require RPC access).

### Test data & fixtures
- **D-16:** Shared fixtures directory at `test/fixtures/` with factory functions: createMockToken(), createMockChainConfig(), mockHoneypotResponse(), etc. Extends the existing chainConfig.ts pattern.
- **D-17:** Shared `MockProvider` class at `test/helpers/mockProvider.ts` -- lightweight class configurable for canned contract call responses.

### Vitest configuration
- **D-18:** Vitest workspace (`vitest.workspace.ts`) defining 3 projects: unit (fast, no network), integration (mocked APIs, mock provider), fork (Hardhat node, slow). Each with its own config, timeouts, and setup files.
- **D-19:** Claude's discretion on timeout values per test type. Fork tests need generous timeouts for contract deployment and swap execution.

### Error & edge case priority
- **D-20:** All 4 error path categories are equal priority -- none should be skipped:
  - API failure fallbacks in safety pipeline (honeypot API down -> static call, GoPlus timeout -> skip, Unicrypt down -> burn check)
  - MEV/transaction edge cases (nonce exhaustion, bundle rejection, gas estimation failure, TX revert)
  - Exit engine edge cases (partial sell failure, price gap past multiple tiers, urgency market sell, concurrent exit triggers)
  - WebSocket/connection failures (RPC disconnect, reconnect, stale price data)

### Claude's Discretion
- Fork tool choice (Hardhat forking vs Anvil) based on existing project setup
- Timeout values per test type (unit, integration, fork)
- Exact MockProvider API surface and configuration approach
- Coverage reporter choice (v8 vs istanbul)
- GitHub Actions workflow file structure and Node.js version matrix
- Whether to add global test setup/teardown files per workspace project
- How to handle environment variables in tests (dotenv vs inline)
- Exact vitest workspace project configuration details

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- TEST-01 through TEST-05 define all testing requirements

### Modules under test
- `src/utils/tokenSafety.ts` -- 9 safety checks with API fallback paths (TEST-01)
- `src/utils/safetyProviders/` -- Chain-specific safety provider adapters
- `src/utils/db.ts` -- SQLite storage with WAL mode, schema migrations (TEST-02)
- `src/utils/txManager.ts` -- MEV-protected transaction submission with retry (TEST-03)
- `src/utils/flashbots.ts` -- Flashbots provider setup
- `src/exitEngine.ts` -- Unified exit engine: trailing stop, partial sells, volatility, urgency (TEST-04)
- `src/utils/exitManager.ts` -- Sell mutex, timer registry
- `src/bot.ts` -- Main bot orchestrator, snipe handlers, pair detection
- `src/riskManager.ts` -- canSnipe() gate, exposure tracking
- `src/chainRegistry.ts` -- Chain config, DexConfig discriminated union
- `src/utils/mevStrategies/` -- Flashbots, bloXroute, passthrough strategy adapters
- `src/api/routes/` -- Express API routes for dashboard (included in coverage)

### Existing test infrastructure
- `test/` -- 4 Phase 4 stub files (to be deleted and rewritten)
- `test/fixtures/chainConfig.ts` -- Existing mock chain config factory (pattern to extend)
- `contracts/FakeToken.sol` -- Test token contract for fork tests
- `contracts/UniswapV2Factory.sol` -- Factory contract for fork test pair creation
- `contracts/UniswapV2Router02.sol` -- Router contract for fork test swaps
- `hardhat.config.ts` -- Hardhat configuration (fork network setup goes here)

### Codebase analysis
- `.planning/codebase/TESTING.md` -- Testing patterns analysis (pre-Phase 9 state)
- `.planning/codebase/CONVENTIONS.md` -- Code patterns to maintain in tests
- `.planning/codebase/STACK.md` -- Tech stack and dependency versions

### Prior phase context
- `.planning/phases/07-smart-exit-strategies/07-CONTEXT.md` -- Exit engine decisions (D-01 through D-26), vitest installed with --legacy-peer-deps

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/fixtures/chainConfig.ts`: Mock chain config factories for ETH, BSC, Base, Arbitrum. Pattern to extend for other fixture types.
- `contracts/FakeToken.sol`, `contracts/UniswapV2Factory.sol`, `contracts/UniswapV2Router02.sol`: Deployed test contracts for fork tests.
- `vitest` 4.1.1 already installed with `test` script configured.
- Existing `package.json` has `"test": "vitest run --reporter=verbose"` -- will be updated to `test:all`.

### Established Patterns
- Schema migration via `user_version` pragma (Phase 3) -- tests should use same migration path.
- Per-token sell mutex in exitManager.ts (Phase 1) -- integration tests must verify mutex behavior.
- DexConfig discriminated union with `dexType` field (Phase 5) -- mock provider needs V2 and V3 response patterns.
- Structured logging with pino (Phase 3) -- tests should suppress log output or use test logger.
- `--legacy-peer-deps` required for npm installs (Phase 7) due to flashbots ethers peer dep conflict.

### Integration Points
- `vitest.workspace.ts` at project root -- new file, configures 3 test projects.
- `package.json` scripts -- update existing `test` script, add granular scripts.
- `hardhat.config.ts` -- add forking configuration for fork tests.
- `.github/workflows/` -- new CI workflow file.

</code_context>

<specifics>
## Specific Ideas

- Delete Phase 4 stubs entirely rather than migrating -- the codebase has evolved too much through Phases 5-8 for those stubs to be useful.
- MockProvider should be a lightweight configurable class, not a full ethers mock -- just needs to handle the specific contract calls the bot makes (getAmountsOut, quoteExactInputSingle, balanceOf, approve, etc.).
- Fork tests deploy fresh contracts on each run rather than depending on historical block state -- more robust and doesn't require archive node access.
- Coverage includes API routes but excludes React dashboard -- keeps the coverage meaningful for the bot's core logic.
- GitHub Actions runs unit + integration but skips fork tests -- avoids needing RPC secrets in CI while still catching regressions.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 09-testing-infrastructure*
*Context gathered: 2026-03-28*
