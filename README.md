<!-- generated-by: gsd-doc-writer -->
# crypto-snipe-bot

A multi-chain EVM token sniping bot that detects new DEX listings, runs a 9-stage safety pipeline, executes MEV-protected trades on Ethereum, BSC, Base, and Arbitrum, and manages exits with automated stop-loss, take-profit, and timed-sell monitors.

## Installation

This is a private project. Clone the repository and install dependencies with npm:

```bash
npm install
```

Requires Node.js (see `package.json` and `tsconfig.json` for the TypeScript target — ES2022) and RPC endpoints for every chain listed in `ENABLED_CHAINS`.

## Quick start

1. Copy the environment template and fill in required values:
   ```bash
   cp .env.example .env
   ```
2. Build the TypeScript sources:
   ```bash
   npm run build
   ```
3. Start the bot (entry point is `src/bot.ts`):
   ```bash
   npx ts-node src/bot.ts
   ```

At minimum `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, and `DASHBOARD_API_KEY` must be set in `.env`. See `.env.example` for the full list with per-chain RPC, snipe amount, MEV, and risk-management variables.

## Usage examples

### Single-chain Ethereum sniping with Flashbots MEV protection

Set the following in `.env` and run `npx ts-node src/bot.ts`:

```env
ENABLED_CHAINS=eth
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_WS_URL=wss://eth-mainnet.ws.alchemy.com/v2/YOUR_KEY
ETH_SNIPE_AMOUNT=0.01
ETH_MAX_CAPITAL=1.0
FLASHBOTS_AUTH_KEY=your_flashbots_signing_key
```

The bot subscribes to Uniswap V2, SushiSwap, and Uniswap V3 factory events, validates each discovered token, and submits approved buys as Flashbots bundles.

### Multi-chain sniping across Ethereum and BSC

```env
ENABLED_CHAINS=eth,bsc
ETH_RPC_URL=...
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BSC_SNIPE_AMOUNT=0.05
BSC_MAX_CAPITAL=5.0
BLOXROUTE_AUTH_HEADER=your_bloxroute_authorization_header
```

BSC trades are routed through bloXroute's private transaction relay; Ethereum trades continue to use Flashbots. A single wallet (`PRIVATE_KEY`) signs for both chains.

### Running the test suite

```bash
npm test                 # full vitest run
npm run test:unit        # unit project only
npm run test:integration # integration project only
npm run test:fork        # fork project only
npm run test:coverage    # with v8 coverage
```

## License

This project is private (`"private": true` in `package.json`) and not published under an open-source license. <!-- VERIFY: licensing terms for distribution or reuse outside this repository -->
