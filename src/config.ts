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
    { name: 'FLASHBOTS_AUTH_KEY', required: false, description: 'Flashbots authentication signing key (required when eth chain enabled)' },
    { name: 'TELEGRAM_ALLOWED_SENDERS', required: false, description: 'Comma-separated allowed Telegram sender IDs' },
    { name: 'TELEGRAM_ALLOWED_CHANNELS', required: false, description: 'Comma-separated allowed Telegram channel/group IDs' },
    // --- Dashboard ---
    { name: 'DASHBOARD_API_KEY', required: true, description: 'Dashboard login API key (required; dashboard server starts unconditionally)' },
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
    // --- Risk Management ---
    { name: 'MAX_OPEN_POSITIONS', required: false, description: 'Max concurrent open positions across all chains (default: 10)' },
    { name: 'MAX_TOTAL_EXPOSURE', required: false, description: 'Max total native currency deployed across all chains (default: 10.0)' },
    { name: 'DAILY_LOSS_PCT', required: false, description: 'Daily loss limit as percentage of per-chain maxCapital (default: 10)' },
    { name: 'SNIPE_COOLDOWN_MS', required: false, description: 'Cooldown between snipes per chain in milliseconds (default: 30000)' },
    { name: 'MAX_POSITION_SIZE', required: false, description: 'Hard cap on native currency per snipe trade (default: uses chain snipeAmount)' },
    // --- Exit Strategy (Phase 7) ---
    { name: 'TRAILING_STOP_PCT', required: false, description: 'Trailing stop pullback percentage from peak (default: 15)' },
    { name: 'TRAILING_MIN_PCT', required: false, description: 'Minimum trailing stop percentage after volatility/urgency adjustment (default: 5)' },
    { name: 'TRAILING_MAX_PCT', required: false, description: 'Maximum trailing stop percentage after volatility adjustment (default: 40)' },
    { name: 'PARTIAL_SELL_TARGETS', required: false, description: 'Partial sell tiers, e.g. "2x:50,5x:25" (default: empty = no partial sells)' },
    { name: 'STOP_LOSS_PCT', required: false, description: 'Fixed stop-loss percentage below entry, active before trailing activates (default: 25)' },

    // --- Anti-Rug Runtime Monitoring (Phase 19, plan 19-02) ---
    // Per D-ENV-EXAMPLE [USER-BINDING]: every var here also lives in
    // .env.example with default + 1-line inline-comment description.
    // 9 vars × 4 chains = 36 entries (8 numeric + 1 comma-list per chain).
    // Env-var delta vs CONTEXT.md D-ENV-EXAMPLE: added BACKFILL_CAP_BLOCKS
    // and MAX_BACKFILL_BLOCKS per 19-RESEARCH.md CRITICAL #1 (Alchemy
    // free-tier 10-block getLogs cap) under CONTEXT.md "Claude's Discretion"
    // on backfill window cap.

    // ETH
    { name: 'ETH_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for ETH (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'ETH_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for ETH (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'ETH_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on ETH (default: 1; higher values for reorg-volatile chains)' },
    { name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for ETH (default: 3; CB trips after N triggers within window)' },
    { name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for ETH (default: 1)' },
    { name: 'ETH_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for ETH (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'ETH_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for ETH (default: 10 Alchemy-free-tier safe per 19-RESEARCH.md CRITICAL #1)' },
    { name: 'ETH_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for ETH; gap > this fires [GAP DETECTED] (default: 7200 = ~1 day on ETH)' },
    { name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'Comma-separated extra V2+V3 locker checksummed addresses for ETH (default: empty; merged into both V2 and V3 allowlists)' },

    // BSC
    { name: 'BSC_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for BSC (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'BSC_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for BSC (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'BSC_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on BSC (default: 1; higher values for reorg-volatile chains)' },
    { name: 'BSC_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for BSC (default: 3; CB trips after N triggers within window)' },
    { name: 'BSC_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for BSC (default: 1)' },
    { name: 'BSC_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for BSC (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'BSC_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for BSC (default: 500 conservative for public BSC RPC / Chainstack)' },
    { name: 'BSC_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for BSC; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'BSC_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'Comma-separated extra V2+V3 locker checksummed addresses for BSC (default: empty; merged into both V2 and V3 allowlists)' },

    // BASE
    { name: 'BASE_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for Base (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'BASE_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for Base (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'BASE_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on Base (default: 1; higher values for reorg-volatile chains)' },
    { name: 'BASE_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for Base (default: 3; CB trips after N triggers within window)' },
    { name: 'BASE_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for Base (default: 1)' },
    { name: 'BASE_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for Base (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'BASE_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for Base (default: 500 conservative for public Base RPC)' },
    { name: 'BASE_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for Base; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'BASE_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'Comma-separated extra V2+V3 locker checksummed addresses for Base (default: empty; merged into both V2 and V3 allowlists)' },

    // ARB
    { name: 'ARB_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for Arbitrum (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'ARB_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for Arbitrum (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'ARB_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on Arbitrum (default: 1; higher values for reorg-volatile chains)' },
    { name: 'ARB_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for Arbitrum (default: 3; CB trips after N triggers within window)' },
    { name: 'ARB_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for Arbitrum (default: 1)' },
    { name: 'ARB_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for Arbitrum (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'ARB_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for Arbitrum (default: 500 conservative for public Arb RPC)' },
    { name: 'ARB_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for Arbitrum; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'ARB_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'Comma-separated extra V2+V3 locker checksummed addresses for Arbitrum (default: empty; merged into both V2 and V3 allowlists)' },
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

    // @deprecated Phase 7 replaces these with exit engine
    stopLossPercent: (() => {
        const val = parseFloat(process.env.STOP_LOSS_PCT || '25');
        return isNaN(val) ? 25 : val;
    })(),
    stopLossCheckInterval: 15000,
    autoSellAfterMs: 5 * 60 * 1000,
    takeProfitPercent: 50,
    takeProfitCheckInterval: 15000,

    // --- Exit Strategy (Phase 7) ---
    trailingStopPct: parseFloat(process.env.TRAILING_STOP_PCT || '15'),
    trailingMinPct: parseFloat(process.env.TRAILING_MIN_PCT || '5'),
    trailingMaxPct: parseFloat(process.env.TRAILING_MAX_PCT || '40'),
    partialSellTargets: process.env.PARTIAL_SELL_TARGETS || '',
    exitPollIntervalMs: 5000,       // D-04: hardcoded 5s
    urgencyWindowMs: 30 * 60 * 1000, // D-17: hardcoded 30 min
    volatilityBaselineCV: 0.03,
    volatilityMaxSamples: 60,        // 5 minutes at 5s polls
    volatilityMinSamples: 12,        // 1 minute minimum
};
