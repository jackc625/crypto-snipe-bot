# Phase 9: Testing Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 09-testing-infrastructure
**Areas discussed:** Test organization & structure, Mocking depth, Mainnet fork tests, Coverage & scope, Test scripts & CI integration, Test data & fixtures, Vitest configuration, Error & edge case priority

---

## Test Organization & Structure

### Test file location

| Option | Description | Selected |
|--------|-------------|----------|
| Separate test/ directory | Keep all tests in test/ mirroring src/ structure. Consistent with Phase 4 stubs. | ✓ |
| Co-located in src/ | Tests next to their source files (e.g., src/utils/db.test.ts). | |
| Hybrid | Unit tests co-located, integration/fork in test/. | |

**User's choice:** Separate test/ directory
**Notes:** Consistent with existing Phase 4 stub pattern. Cleaner source tree.

### Test file organization within test/

| Option | Description | Selected |
|--------|-------------|----------|
| By test type | test/unit/, test/integration/, test/fork/ | ✓ |
| Mirror src/ structure | test/utils/db.test.ts, test/bot.test.ts, etc. | |
| By domain | test/safety/, test/trading/, test/storage/, test/exit/ | |

**User's choice:** By test type
**Notes:** Easy to run subsets.

### Existing Phase 4 test stubs

| Option | Description | Selected |
|--------|-------------|----------|
| Move to test/unit/ and fill in | Relocate and implement stubs. | |
| Delete and rewrite | Start fresh -- stubs may not match post-Phase 5-8 code. | ✓ |
| Keep as-is, add new separately | Don't touch stubs. | |

**User's choice:** Delete and rewrite
**Notes:** Code has changed significantly through Phases 5-8.

### Assertion library

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest built-in expect | Jest-compatible expect(). No extra dependency. | ✓ |
| Keep chai | Already installed. BDD-style assertions. | |

**User's choice:** Vitest built-in expect

---

## Mocking Depth

### Blockchain interaction mocking

| Option | Description | Selected |
|--------|-------------|----------|
| Module-level mocks | vi.mock() on entire modules. | |
| Custom mock provider | Lightweight mock ethers provider with canned responses. | ✓ |
| Hardhat test network | Spin up Hardhat node for unit tests. | |

**User's choice:** Custom mock provider
**Notes:** More realistic than module-level mocks while remaining fast.

### External API mocking

| Option | Description | Selected |
|--------|-------------|----------|
| vi.mock() on axios/fetch | Mock HTTP layer so safety checks run full logic. | ✓ |
| Mock at function level | Mock checkHoneypot() etc. directly. | |
| MSW (Mock Service Worker) | Intercept HTTP requests at network level. | |

**User's choice:** vi.mock() on axios/fetch
**Notes:** Tests verify fallback paths when APIs fail.

### SQLite handling in tests

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory SQLite per test | Fresh :memory: database per test. | ✓ |
| Temp file per test suite | Temp .db file with cleanup. | |
| Shared test database | Single DB with transaction rollback. | |

**User's choice:** In-memory SQLite per test

---

## Mainnet Fork Tests

### Fork tool

| Option | Description | Selected |
|--------|-------------|----------|
| Hardhat network forking | Already in dev dependencies. | |
| Anvil (Foundry) | Faster but requires separate install. | |
| You decide | Claude picks based on project setup. | ✓ |

**User's choice:** You decide (Claude's discretion)

### Fork chain target

| Option | Description | Selected |
|--------|-------------|----------|
| Ethereum mainnet | Most liquidity, Flashbots testing possible. | ✓ |
| Base | Lower gas costs. | |
| Multiple chains | Fork ETH + BSC. More comprehensive. | |

**User's choice:** Ethereum mainnet

### Fork test simulation approach

| Option | Description | Selected |
|--------|-------------|----------|
| Deploy test contracts on fork | Deploy FakeToken + create pair + add liquidity. | ✓ |
| Use known historical pair | Fork at specific block before token launch. | |
| You decide | Claude picks approach. | |

**User's choice:** Deploy test contracts on fork

---

## Coverage & Scope

### Coverage threshold approach

| Option | Description | Selected |
|--------|-------------|----------|
| Requirements-only | Cover exactly TEST-01 to TEST-05. No % target. | |
| 80% on critical modules | Target 80% on key modules. | |
| Full coverage tracking | v8/istanbul on all src/ files with enforced minimum. | ✓ |

**User's choice:** Full coverage tracking

### Minimum coverage threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 70% lines | Pragmatic for bot with heavy external deps. | ✓ |
| 80% lines | Higher bar, more mocking needed. | |
| 60% lines | Lower bar, faster to achieve. | |
| No enforced minimum | Track but don't fail. | |

**User's choice:** 70% lines

### Dashboard frontend in coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude frontend | Phase 9 reqs are all backend. | |
| Include API routes only | Test Express routes, skip React. | ✓ |
| Include everything | Full coverage including React. | |

**User's choice:** Include API routes only

---

## Test Scripts & CI Integration

### Package.json script organization

| Option | Description | Selected |
|--------|-------------|----------|
| Granular scripts | test:unit, test:integration, test:fork, test:all, test:coverage | ✓ |
| Single test script | Just 'test' runs everything. | |
| You decide | Claude sets up scripts. | |

**User's choice:** Granular scripts

### CI pipeline

| Option | Description | Selected |
|--------|-------------|----------|
| No CI for now | Focus on local tests. | |
| Basic GitHub Actions | Run unit + integration on push. Skip fork tests. | ✓ |
| Full CI with secrets | Include fork tests with Alchemy key secret. | |

**User's choice:** Basic GitHub Actions

---

## Test Data & Fixtures

### Fixture organization

| Option | Description | Selected |
|--------|-------------|----------|
| Shared fixtures directory | test/fixtures/ with factory functions. | ✓ |
| Per-test-file fixtures | Each test defines own mock data inline. | |
| JSON fixture files | Static JSON files for API responses. | |

**User's choice:** Shared fixtures directory

### Mock provider approach

| Option | Description | Selected |
|--------|-------------|----------|
| Shared MockProvider class | test/helpers/mockProvider.ts -- configurable class. | ✓ |
| Per-test inline mocks | Each test creates own mock objects. | |
| You decide | Claude designs based on test needs. | |

**User's choice:** Shared MockProvider class

---

## Vitest Configuration

### Configuration approach

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest workspace | vitest.workspace.ts with 3 projects: unit, integration, fork. | ✓ |
| Single config with path filters | One vitest.config.ts with include patterns. | |
| You decide | Claude picks config approach. | |

**User's choice:** Vitest workspace

### Fork test timeouts

| Option | Description | Selected |
|--------|-------------|----------|
| 60 seconds per test | Generous for contract deployment + swaps. | |
| 30 seconds per test | Tighter, forces efficient design. | |
| You decide | Claude picks per test type. | ✓ |

**User's choice:** You decide (Claude's discretion)

---

## Error & Edge Case Priority

### Critical error paths (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| API failure fallbacks | Honeypot/GoPlus/Unicrypt down -> fallback paths. | ✓ |
| MEV/transaction edge cases | Nonce exhaustion, bundle rejection, TX revert. | ✓ |
| Exit engine edge cases | Partial sell failure, price gaps, urgency sell. | ✓ |
| WebSocket/connection failures | RPC disconnect, reconnect, stale data. | ✓ |

**User's choice:** All four categories selected

### Priority ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Safety + Exit first | Money-protecting paths first. | |
| All equal priority | Don't skip any category. | ✓ |
| You decide | Claude prioritizes by risk. | |

**User's choice:** All equal priority

---

## Claude's Discretion

- Fork tool choice (Hardhat forking vs Anvil)
- Timeout values per test type
- MockProvider API surface design
- Coverage reporter (v8 vs istanbul)
- GitHub Actions workflow details

## Deferred Ideas

None -- discussion stayed within phase scope
