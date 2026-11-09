<!-- generated-by: gsd-doc-writer -->
# Getting Started

This guide walks you from a fresh clone to the bot running against your configured chains.
It covers prerequisites, installation, first run, and the issues new operators most often
hit during initial setup.

## Prerequisites

You must have the following installed and available before continuing.

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | `>=22` | The CI workflow at `.github/workflows/test.yml` pins `node-version: '22'`. The TypeScript build target is `ES2022` (`tsconfig.json`). |
| npm | bundled with Node 22 | Used for dependency install; `package-lock.json` is committed. |
| Git | any recent version | Required to clone the repository. |

You will also need:

- A funded EVM wallet private key (`PRIVATE_KEY`) for every chain you intend to enable.
- HTTP RPC endpoints (and optionally WebSocket endpoints) for each enabled chain in
  `ENABLED_CHAINS` (`eth`, `bsc`, `base`, `arb`).
- A Flashbots auth signing key when Ethereum is enabled, and/or a bloXroute auth header
  when BSC is enabled (`src/chainRegistry.ts:315-322` makes both fatal at startup when
  the corresponding chain is enabled).
- A Telegram bot token plus a Telegram user API ID/hash/session for the alert and
  alpha-signal listener subsystems. See `.env.example` for where to obtain each value
  (`@BotFather` and `my.telegram.org`).
- A strong random `DASHBOARD_API_KEY` — the dashboard API server starts unconditionally
  and refuses startup without one.

See `docs/CONFIGURATION.md` for the complete environment-variable reference and the
exact failure mode when a required variable is missing.

## Installation steps

1. Clone the repository and enter the project directory:
   ```bash
   git clone <repository-url> crypto-snipe-bot
   cd crypto-snipe-bot
   ```
   <!-- VERIFY: canonical remote URL for cloning this private repository -->

2. Install dependencies. CI uses `--legacy-peer-deps` (`.github/workflows/test.yml:17`);
   match that locally to avoid peer-dependency resolution failures from the Hardhat
   toolbox:
   ```bash
   npm install --legacy-peer-deps
   ```

3. Copy the environment template and edit it:
   ```bash
   cp .env.example .env
   ```
   At minimum, fill in `PRIVATE_KEY`, `ALCHEMY_URL` (still required by the legacy
   `REQUIRED_ENV_VARS` validator in `src/config.ts:13-66` even when `ETH_RPC_URL`
   is supplied), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`,
   `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `DASHBOARD_API_KEY`.

4. (Optional) Build the TypeScript sources to `dist/` if you want compiled output:
   ```bash
   npm run build
   ```
   Runtime execution uses `ts-node` directly and does not require a prior build.

## First run

Start the bot from the repository root using `ts-node`:

```bash
npx ts-node src/main.ts
```

`src/main.ts` is the canonical entry point (starting `src/bot.ts` directly now refuses
before it loads anything): it takes the single-instance process lock and then starts
`src/bot.ts`, which loads `src/config.ts` (which calls
`validateEnvVars()` and exits the process with a fatal log if any required variable
is missing), constructs the multi-chain registry from `src/chainRegistry.ts`, starts
the dashboard API server (`src/api/server.ts`), starts the Telegram alpha-signal
listener (`src/telegramListener.ts`), and subscribes to DEX factory events on every
enabled chain.

A successful first run prints structured `pino` logs to stdout, opens an SQLite
database at `./data/bot.db` (override with `DB_PATH`), and binds the dashboard
HTTP server on `127.0.0.1:8080` by default (override with `DASHBOARD_HOST` /
`DASHBOARD_PORT`).

To verify your install before running against live chains, run the unit and
integration test suites:

```bash
npm run test:unit
npm run test:integration
```

These are the same two commands CI runs on every push to `main` or `master`.

## Common setup issues

- **Startup exits immediately with "Missing required environment variables"** —
  `validateEnvVars()` in `src/config.ts:68-79` aborts the process when any
  `required: true` entry in `REQUIRED_ENV_VARS` is unset. Inspect the missing-var
  list it prints and add each one to `.env`. Note that `ALCHEMY_URL` is required
  by the legacy validator even if you have set `ETH_RPC_URL`.

- **`Missing FLASHBOTS_AUTH_KEY` (or `BLOXROUTE_AUTH_HEADER`) fatal at startup** —
  These are conditionally required by `src/chainRegistry.ts:315-322` whenever
  `eth` (Flashbots) or `bsc` (bloXroute) appears in `ENABLED_CHAINS`. Either
  supply the credential or remove that chain from `ENABLED_CHAINS`.

- **`npm install` fails with peer-dependency conflicts** — The Hardhat toolbox
  pulls in deeply pinned peers. Use `npm install --legacy-peer-deps` (matching
  CI). Do not switch to `yarn` or `pnpm` — only `package-lock.json` is committed.

- **`TELEGRAM_SESSION` is missing and no helper exists** — there is no automated
  helper to generate a Telegram session string. Generate it manually using the
  `telegram` package's `StringSession` workflow. (Historical note: a placeholder
  `auth.ts` once existed at the repo root but was never implemented; it was
  removed in cleanup task 260429-cleanup-empty-files.)
  <!-- VERIFY: intended location and contents of the Telegram session-generation helper -->

- **Port 8080 already in use** — The dashboard API server defaults to
  `127.0.0.1:8080`. Override with `DASHBOARD_PORT=<other-port>` in `.env`.

- **Dashboard refuses connections from another machine** — `DASHBOARD_HOST`
  defaults to `127.0.0.1` (loopback only). Set `DASHBOARD_HOST=0.0.0.0` to
  expose it, but only behind appropriate network controls — `DASHBOARD_API_KEY`
  is the only authentication layer.

## Next steps

- `docs/ARCHITECTURE.md` — system overview, component layout, and data flow from
  factory event to executed trade and exit monitoring.
- `docs/CONFIGURATION.md` — complete reference for every environment variable,
  including per-chain RPC, capital, MEV, and risk-management settings.
- `README.md` — quick-start summary and copy-pasteable single-chain and
  multi-chain configuration examples.
