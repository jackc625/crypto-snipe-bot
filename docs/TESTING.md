<!-- generated-by: gsd-doc-writer -->
# Testing

## Test Framework and Setup

`crypto-snipe-bot` uses **[Vitest](https://vitest.dev/) `^4.1.1`** as its sole JavaScript/TypeScript test runner, configured with the v8 coverage provider (`@vitest/coverage-v8 ^4.1.2`). Solidity contracts under `contracts/` are tested separately via the Hardhat toolbox (`hardhat ^2.26.0` plus `@nomicfoundation/hardhat-toolbox ^6.1.0`), but the npm test scripts described below cover the TypeScript test suite only.

The Vitest configuration in `vitest.config.ts` declares **three independent test projects**:

| Project | Source path | `testTimeout` | Notes |
|---------|-------------|---------------|-------|
| `unit` | `test/unit/**/*.test.ts` | 5000 ms | `mockReset: true`, Node environment |
| `integration` | `test/integration/**/*.test.ts` | 15000 ms | `mockReset: true`, Node environment |
| `fork` | `test/fork/**/*.test.ts` | 120000 ms | Spawns a forked Hardhat node via `test/fork/setup.ts` |

`vitest.config.ts` calls `dotenv.config()` at module load, so any variable defined in `.env` (see `docs/CONFIGURATION.md`) is available to the test runtime. No additional setup is required beyond installing dependencies:

```bash
npm install --legacy-peer-deps
```

The `--legacy-peer-deps` flag matches the install step used by CI (`.github/workflows/test.yml`) and is necessary because of peer-dependency conflicts between several Hardhat plugins.

### Fork-test prerequisites

The `fork` project requires a JSON-RPC URL pointing to a real Ethereum mainnet node (Alchemy, Infura, etc.). Set **either** `ETH_FORK_RPC_URL` **or** `ALCHEMY_URL` in your environment before invoking `npm run test:fork`; the global setup hook in `test/fork/setup.ts` throws if neither is present. The setup hook also runs `npx hardhat compile --quiet` to produce contract artifacts and then spawns `npx hardhat node --fork <rpc> --port 8545`, waiting up to 30 s for the `Started HTTP` log line.

## Running Tests

The test commands are defined in `package.json` `scripts`:

```bash
# Run all TypeScript tests (unit + integration + fork)
npm test
npm run test:all

# Run a single project
npm run test:unit
npm run test:integration
npm run test:fork

# Run the full suite with v8 coverage
npm run test:coverage
```

All scripts pass `--reporter=verbose` so each test name and assertion is printed. To filter to a specific test file or pattern, append a Vitest CLI argument:

```bash
# Single file
npx vitest run test/unit/riskManager.test.ts

# Filter by test name (substring match against describe/it strings)
npx vitest run -t "concurrent writes"

# Watch mode for iterative development (no script alias provided)
npx vitest --project unit
```

## Writing New Tests

### File naming and location

- Every test file ends in `.test.ts` (the only pattern matched by `vitest.config.ts`).
- Place files under the project directory that matches their scope:
  - `test/unit/` — pure-function and isolated-class tests with no network or filesystem dependencies.
  - `test/integration/` — multi-module flows that may use `express`/`ws` test servers; subdirectory `test/integration/api/` covers the dashboard API surface (`auth`, `chains`, `controls`, `health`, `positions`, `risk`, `trades`, `wsPush`).
  - `test/fork/` — end-to-end scenarios that interact with the spawned Hardhat fork (e.g. `snipeLifecycle.test.ts`).

### Test helpers

Two shared helpers under `test/helpers/` are reused throughout the suite:

- `test/helpers/testDb.ts` exports `createTestDb()`, which returns an isolated in-memory `better-sqlite3` instance preloaded with the production schema (`trades`, `exit_state`, indexes, `user_version = 4`). Use it for any test that touches the storage layer to guarantee zero cross-test contamination.
- `test/helpers/mockProvider.ts` exports `createMockProvider(overrides?)` and `createMockContract(methods?)`, which produce ethers v6-compatible provider and contract stubs backed by `vi.fn()`. Override individual methods by passing them in the argument object.

### Fixtures

Reusable test inputs live in `test/fixtures/`:

| File | Purpose |
|------|---------|
| `api.fixtures.ts` | Sample request/response payloads for dashboard API tests |
| `chainConfig.ts` | Multi-chain configuration objects |
| `exitEngine.fixtures.ts` | Position/exit-state inputs for the exit engine |
| `receipt.fixtures.ts` | Synthetic transaction receipts for the receipt decoder |
| `tokenSafety.fixtures.ts` | Honeypot/safety-provider response fixtures |
| `txManager.fixtures.ts` | Transaction-manager call inputs |

### Conventions

- Import test primitives from `vitest`: `import { describe, it, expect, vi } from 'vitest';`.
- Each test must close any resources it opens (DB connections, intervals, child processes); `mockReset: true` in unit and integration projects ensures `vi.fn()` history is cleared between tests, but it does **not** clear handles.
- Match the existing style: top-level `describe(<feature> (<ticket id>))`, nested `describe` for sub-areas, and a brief comment header at the top of each file describing what is under test (see `test/unit/db.test.ts` for an example).

## Coverage Requirements

`vitest.config.ts` configures the v8 coverage provider with the following thresholds. All four must be met for `npm run test:coverage` to exit 0:

| Type | Threshold |
|------|-----------|
| Lines | 70% |
| Functions | 70% |
| Branches | 70% |
| Statements | 70% |

Coverage is collected from `src/**/*.ts` with `src/dashboard/**` and any `*.d.ts` files excluded. Reports are written to `./coverage/` in `text`, `html`, and `json-summary` formats; open `coverage/index.html` in a browser for the per-file breakdown.

## CI Integration

The repository ships a single GitHub Actions workflow at `.github/workflows/test.yml` (job name **`test`**, workflow name **`Tests`**). It runs on `push` and `pull_request` events targeting the `main` or `master` branches.

Steps executed on `ubuntu-latest` with Node.js `22` and the npm cache enabled:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 22, npm cache)
3. `npm ci --legacy-peer-deps`
4. `npm run test:unit`
5. `npm run test:integration`

The `fork` project is **not** executed in CI, since it requires an external mainnet RPC URL. Run `npm run test:fork` locally before merging changes that touch the snipe lifecycle, transaction manager, or any code path exercised under `test/fork/`.

Coverage thresholds are not enforced by the CI workflow as configured today; run `npm run test:coverage` locally to verify them before opening a pull request.
