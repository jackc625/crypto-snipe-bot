// src/config.ts
import * as dotenv from "dotenv";
import addresses from "./addresses.json";
dotenv.config();

// --- Startup Environment Validation ---
interface EnvVarSpec {
    name: string;
    required: boolean;
    description: string;
}

const REQUIRED_ENV_VARS: EnvVarSpec[] = [
    { name: 'PRIVATE_KEY', required: true, description: 'Wallet private key for signing transactions' },
    { name: 'ALCHEMY_URL', required: true, description: 'Alchemy RPC endpoint URL' },
    { name: 'TELEGRAM_BOT_TOKEN', required: true, description: 'Telegram bot token for alerts' },
    { name: 'TELEGRAM_CHAT_ID', required: true, description: 'Telegram chat ID for alerts' },
    { name: 'TELEGRAM_API_ID', required: true, description: 'Telegram API ID for listener' },
    { name: 'TELEGRAM_API_HASH', required: true, description: 'Telegram API hash for listener' },
    { name: 'TELEGRAM_SESSION', required: true, description: 'Telegram session string' },
    { name: 'FLASHBOTS_AUTH_KEY', required: true, description: 'Flashbots authentication signing key' },
    { name: 'TELEGRAM_ALLOWED_SENDERS', required: false, description: 'Comma-separated allowed Telegram sender IDs' },
    { name: 'TELEGRAM_ALLOWED_CHANNELS', required: false, description: 'Comma-separated allowed Telegram channel/group IDs' },
    { name: 'NETWORK', required: false, description: 'Target network: sepolia (default), mainnet' },
];

function validateEnvVars(): void {
    const missing: string[] = [];
    for (const spec of REQUIRED_ENV_VARS) {
        if (spec.required && !process.env[spec.name]) {
            missing.push(`  - ${spec.name}: ${spec.description}`);
        }
    }
    if (missing.length > 0) {
        console.error(`\n[STARTUP ERROR] Missing required environment variables:\n${missing.join('\n')}\n`);
        console.error('Create a .env file with these variables or set them in your environment.\n');
        process.exit(1);
    }
}

validateEnvVars();
// --- End Validation ---

export const rpc = {
    sepolia: process.env.ALCHEMY_URL!,
    mainnet: process.env.ALCHEMY_URL!,
    bsc: "https://bsc-dataseed.binance.org/"
};

export type SupportedNetwork = keyof typeof rpc;

// --- Network Validation ---
const networkInput = (process.env.NETWORK || 'sepolia').toLowerCase();
const validNetworks = Object.keys(rpc);
if (!validNetworks.includes(networkInput)) {
    console.error(`\n[STARTUP ERROR] Unsupported network: "${networkInput}"`);
    console.error(`Valid networks: ${validNetworks.join(', ')}\n`);
    process.exit(1);
}
// --- End Network Validation ---

export const CONFIG = {
    network: networkInput as SupportedNetwork,
    rpc,
    walletPrivateKey: process.env.PRIVATE_KEY!,

    ...addresses,

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
