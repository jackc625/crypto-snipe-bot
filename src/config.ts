// src/config.ts
import * as dotenv from "dotenv";
import { logger } from './utils/logger';
dotenv.config();

// --- Startup Environment Validation ---
interface EnvVarSpec {
    name: string;
    required: boolean;
    description: string;
}

const REQUIRED_ENV_VARS: EnvVarSpec[] = [
    // --- Core ---
    { name: 'PRIVATE_KEY', required: true, description: 'Wallet private key for signing transactions' },
    { name: 'ALCHEMY_URL', required: true, description: 'Alchemy RPC endpoint URL (legacy, use ETH_RPC_URL instead)' },
    // --- Telegram ---
    { name: 'TELEGRAM_BOT_TOKEN', required: true, description: 'Telegram bot token for alerts' },
    { name: 'TELEGRAM_CHAT_ID', required: true, description: 'Telegram chat ID for alerts' },
    { name: 'TELEGRAM_API_ID', required: true, description: 'Telegram API ID for listener' },
    { name: 'TELEGRAM_API_HASH', required: true, description: 'Telegram API hash for listener' },
    { name: 'TELEGRAM_SESSION', required: true, description: 'Telegram session string' },
    { name: 'FLASHBOTS_AUTH_KEY', required: true, description: 'Flashbots authentication signing key' },
    { name: 'TELEGRAM_ALLOWED_SENDERS', required: false, description: 'Comma-separated allowed Telegram sender IDs' },
    { name: 'TELEGRAM_ALLOWED_CHANNELS', required: false, description: 'Comma-separated allowed Telegram channel/group IDs' },
    // --- Multi-Chain Configuration ---
    { name: 'ENABLED_CHAINS', required: false, description: 'Comma-separated enabled chains: eth,bsc,base,arb (default: eth)' },
    // --- Per-Chain RPC URLs ---
    { name: 'ETH_RPC_URL', required: false, description: 'Ethereum HTTP RPC URL (required if eth enabled)' },
    { name: 'ETH_WS_URL', required: false, description: 'Ethereum WebSocket RPC URL' },
    { name: 'BSC_RPC_URL', required: false, description: 'BSC HTTP RPC URL (required if bsc enabled)' },
    { name: 'BSC_WS_URL', required: false, description: 'BSC WebSocket RPC URL' },
    { name: 'BASE_RPC_URL', required: false, description: 'Base HTTP RPC URL (required if base enabled)' },
    { name: 'BASE_WS_URL', required: false, description: 'Base WebSocket RPC URL' },
    { name: 'ARB_RPC_URL', required: false, description: 'Arbitrum HTTP RPC URL (required if arb enabled)' },
    { name: 'ARB_WS_URL', required: false, description: 'Arbitrum WebSocket RPC URL' },
    // --- MEV Protection ---
    { name: 'BLOXROUTE_AUTH_HEADER', required: false, description: 'bloXroute auth header for BSC MEV protection' },
    // --- Per-Chain Capital ---
    { name: 'ETH_SNIPE_AMOUNT', required: false, description: 'ETH snipe amount per trade (default: 0.01)' },
    { name: 'ETH_MAX_CAPITAL', required: false, description: 'ETH max capital deployment (default: 1.0)' },
    { name: 'BSC_SNIPE_AMOUNT', required: false, description: 'BSC snipe amount in BNB (default: 0.05)' },
    { name: 'BSC_MAX_CAPITAL', required: false, description: 'BSC max capital in BNB (default: 5.0)' },
    { name: 'BASE_SNIPE_AMOUNT', required: false, description: 'Base snipe amount in ETH (default: 0.005)' },
    { name: 'BASE_MAX_CAPITAL', required: false, description: 'Base max capital in ETH (default: 0.5)' },
    { name: 'ARB_SNIPE_AMOUNT', required: false, description: 'Arbitrum snipe amount in ETH (default: 0.005)' },
    { name: 'ARB_MAX_CAPITAL', required: false, description: 'Arbitrum max capital in ETH (default: 0.5)' },
    // --- General ---
    { name: 'LOG_LEVEL', required: false, description: 'Logging level: debug, info, warn, error (default: info)' },
    { name: 'DB_PATH', required: false, description: 'SQLite database file path (default: ./data/bot.db)' },
    { name: 'NETWORK', required: false, description: 'Target network: sepolia (default), mainnet (legacy)' },
];

function validateEnvVars(): void {
    const missing: string[] = [];
    for (const spec of REQUIRED_ENV_VARS) {
        if (spec.required && !process.env[spec.name]) {
            missing.push(`  - ${spec.name}: ${spec.description}`);
        }
    }
    if (missing.length > 0) {
        logger.fatal({ missing: missing.map(m => m.trim().replace(/^- /, '')) }, 'Missing required environment variables');
        process.exit(1);
    }
}

validateEnvVars();
// --- End Validation ---

// Legacy single-chain RPC map -- being replaced by ChainConfig in chainRegistry.ts.
// ETH_RPC_URL takes priority over ALCHEMY_URL when set.
export const rpc = {
    sepolia: process.env.ETH_RPC_URL || process.env.ALCHEMY_URL!,
    mainnet: process.env.ETH_RPC_URL || process.env.ALCHEMY_URL!,
    bsc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/"
};

export type SupportedNetwork = keyof typeof rpc;

// --- Network Validation ---
const networkInput = (process.env.NETWORK || 'sepolia').toLowerCase();
const validNetworks = Object.keys(rpc);
if (!validNetworks.includes(networkInput)) {
    logger.fatal({ network: networkInput, validNetworks }, 'Unsupported network');
    process.exit(1);
}
// --- End Network Validation ---

// Legacy single-chain CONFIG -- being replaced by ChainConfig in chainRegistry.ts.
// Kept intact for backward compatibility during incremental migration.
export const CONFIG = {
    network: networkInput as SupportedNetwork,
    rpc,
    walletPrivateKey: process.env.PRIVATE_KEY!,

    // Legacy ETH mainnet Uniswap V2 addresses (matches chainRegistry eth template).
    // Used by backward-compatible singleton functions (handleNewPair, executeSell, etc.).
    // The multi-chain code path uses ChainConfig from chainRegistry.ts instead.
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',

    snipeAmountETH: "0.01",
    slippage: 0.1,
    slippagePercent: 5,
    gasMultiplier: 1.2,
    gasLimit: 300_000,
    slippageTolerance: 0.1,

    honeypotCheckURL: "https://api.honeypot.is/v1/TokenInfo/",
    stopLossPercent: 25,
    stopLossCheckInterval: 15000,
    autoSellAfterMs: 5 * 60 * 1000,
    takeProfitPercent: 50,
    takeProfitCheckInterval: 15000,
};
