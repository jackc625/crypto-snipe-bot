<!-- generated-by: gsd-doc-writer -->
# Development

This guide covers setting up `crypto-snipe-bot` for local development, the available build and test scripts, and the project's code style and contribution conventions. For first-time setup and a quick start, see `README.md`. For system design, see `docs/ARCHITECTURE.md`. For environment variables and configuration, see `docs/CONFIGURATION.md`.

## Local setup

This is a private repository (`"private": true` in `package.json`), so contributors typically clone directly rather than fork.

1. Clone the repository and enter the project directory:
   ```bash
   git clone <repo-url>
   cd crypto-snipe-bot
   ```
2. Install dependencies. The CI workflow uses `--legacy-peer-deps`, so the same flag is recommended locally to match the lockfile resolution:
   ```bash
   npm install --legacy-peer-deps
   ```
3. Copy the environment template and populate secrets and per-chain RPC endpoints:
   ```bash
   cp .env.example .env
   ```
   At minimum `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `DASHBOARD_API_KEY` must be set before the bot will start. See `docs/CONFIGURATION.md` for the full variable reference.
4. Compile the TypeScript sources once to produce `dist/` and to verify type correctness:
   ```bash
   npm run build
   ```
5. Run the bot entry point directly from TypeScript for development (no compile step required between edits):
   ```bash
   npx ts-node src/main.ts
   ```

Node.js 22 is used in CI (`.github/workflows/test.yml` pins `node-version: '22'`). The TypeScript target is ES2022 (`tsconfig.json`). The project is CommonJS (`"type": "commonjs"` in `package.json`).

Smart-contract and fork-test workflows additionally use Hardhat with Solidity `0.8.28` (see `hardhat.config.ts`). Fork tests require `ETH_FORK_RPC_URL` or `ALCHEMY_URL` to be set in `.env`.

## Build commands

All commands are defined in `package.json` `scripts` and run via `npm run <name>` (or `npm test` for the default test script).

| Command | Description |
| --- | --- |
| `npm run build` | Compiles TypeScript with `tsc` using `tsconfig.json`; emits output to `dist/`. |
| `npm test` | Runs the full Vitest suite (unit + integration + fork) with the verbose reporter. |
| `npm run test:unit` | Runs only the `unit` Vitest project (`test/unit/**/*.test.ts`, 5s timeout). |
| `npm run test:integration` | Runs only the `integration` Vitest project (`test/integration/**/*.test.ts`, 15s timeout). |
| `npm run test:fork` | Runs only the `fork` Vitest project (`test/fork/**/*.test.ts`, 120s timeout, requires fork RPC). |
| `npm run test:all` | Alias for `npm test` — runs every Vitest project. |
| `npm run test:coverage` | Runs the full suite with the v8 coverage provider; writes reports to `./coverage`. |

`npm start` runs `ts-node src/main.ts`, the same as `npx ts-node src/main.ts`: it takes the single-instance process lock and then starts the bot (see `README.md`). Starting `src/bot.ts` directly now refuses before it loads anything. There is no dedicated `lint` or `format` script — run ESLint directly (see below).

Other project directories referenced by build tooling:
- `dist/` — `tsc` output (git-ignored).
- `artifacts/`, `cache/`, `typechain-types/` — Hardhat/TypeChain generated output (git-ignored).
- `coverage/` — Vitest coverage reports (git-ignored).

## Code style

ESLint (flat config) is the single source of truth for lint rules. No Prettier, Biome, or `.editorconfig` file is configured in the repository.

- **Linter**: ESLint 9 with `typescript-eslint`. Config: `eslint.config.mjs`.
- **Config extends**: `tseslint.configs.recommendedTypeChecked` (type-aware rules; uses `projectService: true`).
- **Custom rules enforced**:
  - `@typescript-eslint/restrict-plus-operands` (error) with `allowNumberAndString: false` and `skipCompoundAssignments: false` — flags BigInt/Number mixing at lint time (internal rule ID `D-07`).
  - `@typescript-eslint/no-unsafe-argument` (warn).
- **Ignored paths**: `dist/`, `artifacts/`, `cache/`, `typechain-types/`, `node_modules/`.

Run ESLint manually with:

```bash
npx eslint .
```

TypeScript is configured in strict mode (`"strict": true` in both `tsconfig.json` and `tsconfig.bot.json`). Type-check without emitting via:

```bash
npx tsc --noEmit
```

## Branch conventions

The default branch is `main` (renamed from `master` on 2026-11-06). The `Tests` CI workflow (`.github/workflows/test.yml`) triggers on pushes and pull requests targeting both `main` and `master`, so either is accepted as a base branch.

No branch-naming convention is documented in the repository. No `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, or `.github/PULL_REQUEST_TEMPLATE.md` exists at the time of writing. <!-- VERIFY: any team-internal branch-naming or commit-message conventions maintained outside this repository -->

## PR process

Because no PR template is committed, the following minimum expectations are derived from the CI configuration and repository state:

- Open a pull request against `main` or `master` (both trigger CI).
- CI must pass. The `Tests` workflow runs `npm ci --legacy-peer-deps`, then `npm run test:unit`, then `npm run test:integration` on Node.js 22 (Ubuntu).
- Fork tests (`npm run test:fork`) are **not** part of CI because they require an RPC fork URL; run them locally when changes touch on-chain execution paths (`src/exitEngine.ts`, chain-registry code, or anything that calls a provider).
- Run `npx eslint .` and `npx tsc --noEmit` locally before opening the PR — these are not enforced in CI but will surface type and BigInt-safety regressions early.
- Never commit secrets. `.env`, `.env.*` (except `.env.example`), `cookies.txt`, `*.pem`, `*.key`, `data/`, and `.bot-state.json*` are all listed in `.gitignore`; verify any new credentials path is ignored before pushing.
- Audit merges carefully when resolving conflicts involving `src/bot.ts`, `src/config.ts`, or the exit engine — these modules carry critical state and have caused regressions during past merge commits.

<!-- VERIFY: reviewer assignment policy, required approvals, and merge strategy (squash/merge/rebase) configured on the remote -->
