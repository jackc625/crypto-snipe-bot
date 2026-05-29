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
    { name: 'DASHBOARD_ALLOWED_ORIGINS', required: false, description: 'Comma-separated EXTRA browser origins allowed to call the dashboard API (CORS). Empty default = same-origin works (the SPA served by the bot at DASHBOARD_HOST:DASHBOARD_PORT); set ONLY for cross-origin/remote dashboards' },
    { name: 'DASHBOARD_TRUST_PROXY_PROTO', required: false, description: 'Set to 1 ONLY behind a TLS-terminating reverse proxy: trusts X-Forwarded-Proto so the CORS same-origin check sees the browser-facing https scheme instead of the plain-http proxy->bot hop. Default off = scheme read from the real socket. Does NOT enable Express `trust proxy` or trust any other forwarded header' },
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

    // --- Anti-Rug Runtime Monitoring (Phase 19, plan 19-02 + WR-08 iter-1 + WR-08-FOLLOWUP iter-2) ---
    // Per D-ENV-EXAMPLE [USER-BINDING]: every var here also lives in
    // .env.example with default + 1-line inline-comment description.
    // 11 vars × 4 chains = 44 entries (8 numeric + 3 comma-list per chain).
    // Env-var delta vs CONTEXT.md D-ENV-EXAMPLE: added BACKFILL_CAP_BLOCKS
    // and MAX_BACKFILL_BLOCKS per 19-RESEARCH.md CRITICAL #1 (Alchemy
    // free-tier 10-block getLogs cap) under CONTEXT.md "Claude's Discretion"
    // on backfill window cap. WR-08 (iter-1) added ALLOWLIST_EXTRA_V2 and
    // ALLOWLIST_EXTRA_V3 in chainRegistry.ts to avoid placing V2-only lockers
    // in the V3 allowlist (or vice versa); WR-08-FOLLOWUP (iter-2) registers
    // those new vars here so operators can discover them via the canonical
    // env-vars source-of-truth and so .env.example covers them.

    // ETH
    { name: 'ETH_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for ETH (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'ETH_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for ETH (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'ETH_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on ETH (default: 1; higher values for reorg-volatile chains)' },
    { name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for ETH (default: 3; CB trips after N triggers within window)' },
    { name: 'ETH_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for ETH (default: 1)' },
    { name: 'ETH_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for ETH (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'ETH_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for ETH (default: 10 Alchemy-free-tier safe per 19-RESEARCH.md CRITICAL #1)' },
    { name: 'ETH_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for ETH; gap > this fires [GAP DETECTED] (default: 7200 = ~1 day on ETH)' },
    { name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'DEPRECATED unified V2+V3 locker overlay for ETH (default: empty; prefer per-pool-type ALLOWLIST_EXTRA_V2 / ALLOWLIST_EXTRA_V3 to avoid placing V2-only lockers in the V3 allowlist or vice versa; deprecation warn fires at startup when set)' },
    { name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA_V2', required: false, description: 'V2-only locker checksummed addresses for ETH (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },
    { name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA_V3', required: false, description: 'V3-only locker checksummed addresses for ETH (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },

    // BSC
    { name: 'BSC_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for BSC (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'BSC_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for BSC (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'BSC_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on BSC (default: 1; higher values for reorg-volatile chains)' },
    { name: 'BSC_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for BSC (default: 3; CB trips after N triggers within window)' },
    { name: 'BSC_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for BSC (default: 1)' },
    { name: 'BSC_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for BSC (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'BSC_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for BSC (default: 500 conservative for public BSC RPC / Chainstack)' },
    { name: 'BSC_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for BSC; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'BSC_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'DEPRECATED unified V2+V3 locker overlay for BSC (default: empty; prefer per-pool-type ALLOWLIST_EXTRA_V2 / ALLOWLIST_EXTRA_V3 to avoid placing V2-only lockers in the V3 allowlist or vice versa; deprecation warn fires at startup when set)' },
    { name: 'BSC_ANTIRUG_ALLOWLIST_EXTRA_V2', required: false, description: 'V2-only locker checksummed addresses for BSC (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },
    { name: 'BSC_ANTIRUG_ALLOWLIST_EXTRA_V3', required: false, description: 'V3-only locker checksummed addresses for BSC (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },

    // BASE
    { name: 'BASE_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for Base (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'BASE_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for Base (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'BASE_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on Base (default: 1; higher values for reorg-volatile chains)' },
    { name: 'BASE_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for Base (default: 3; CB trips after N triggers within window)' },
    { name: 'BASE_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for Base (default: 1)' },
    { name: 'BASE_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for Base (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'BASE_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for Base (default: 500 conservative for public Base RPC)' },
    { name: 'BASE_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for Base; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'BASE_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'DEPRECATED unified V2+V3 locker overlay for Base (default: empty; prefer per-pool-type ALLOWLIST_EXTRA_V2 / ALLOWLIST_EXTRA_V3 to avoid placing V2-only lockers in the V3 allowlist or vice versa; deprecation warn fires at startup when set)' },
    { name: 'BASE_ANTIRUG_ALLOWLIST_EXTRA_V2', required: false, description: 'V2-only locker checksummed addresses for Base (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },
    { name: 'BASE_ANTIRUG_ALLOWLIST_EXTRA_V3', required: false, description: 'V3-only locker checksummed addresses for Base (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },

    // ARB
    { name: 'ARB_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for Arbitrum (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
    { name: 'ARB_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for Arbitrum (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
    { name: 'ARB_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on Arbitrum (default: 1; higher values for reorg-volatile chains)' },
    { name: 'ARB_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', required: false, description: 'Anti-rug circuit-breaker trigger threshold for Arbitrum (default: 3; CB trips after N triggers within window)' },
    { name: 'ARB_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS', required: false, description: 'Anti-rug circuit-breaker rolling window in hours for Arbitrum (default: 1)' },
    { name: 'ARB_ANTIRUG_GAS_MULTIPLIER', required: false, description: 'Anti-rug exit gas multiplier for Arbitrum (default: 2.0; applied to EIP-1559 fields when reason=anti-rug)' },
    { name: 'ARB_ANTIRUG_BACKFILL_CAP_BLOCKS', required: false, description: 'Anti-rug per-getLogs-call block-range cap for Arbitrum (default: 500 conservative for public Arb RPC)' },
    { name: 'ARB_ANTIRUG_MAX_BACKFILL_BLOCKS', required: false, description: 'Anti-rug hard ceiling on backfill window for Arbitrum; gap > this fires [GAP DETECTED] (default: 7200)' },
    { name: 'ARB_ANTIRUG_ALLOWLIST_EXTRA', required: false, description: 'DEPRECATED unified V2+V3 locker overlay for Arbitrum (default: empty; prefer per-pool-type ALLOWLIST_EXTRA_V2 / ALLOWLIST_EXTRA_V3 to avoid placing V2-only lockers in the V3 allowlist or vice versa; deprecation warn fires at startup when set)' },
    { name: 'ARB_ANTIRUG_ALLOWLIST_EXTRA_V2', required: false, description: 'V2-only locker checksummed addresses for Arbitrum (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },
    { name: 'ARB_ANTIRUG_ALLOWLIST_EXTRA_V3', required: false, description: 'V3-only locker checksummed addresses for Arbitrum (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },

    // --- Going-Live Ops Hardening (Phase 20, plan 20-02) ---
    // Per D-ENV-EXAMPLE [USER-BINDING]: every var here lives in .env.example
    // with default + 1-line inline-comment description. All required: false.
    // Per-chain gas buffers (native units) for the preflight wallet-balance
    // floor (D-BALANCE-FLOOR) and the mid-run undercut detector. Defaults
    // chosen for capital safety on ~0.0124 ETH funded mainnet wallet.
    { name: 'ETH_GAS_BUFFER', required: false, description: 'Per-chain gas buffer added to preflight wallet-balance floor for ETH (native units, default: 0.005)' },
    { name: 'BSC_GAS_BUFFER', required: false, description: 'Per-chain gas buffer added to preflight wallet-balance floor for BSC (native units, default: 0.003)' },
    { name: 'BASE_GAS_BUFFER', required: false, description: 'Per-chain gas buffer added to preflight wallet-balance floor for Base (native units, default: 0.0005)' },
    { name: 'ARB_GAS_BUFFER', required: false, description: 'Per-chain gas buffer added to preflight wallet-balance floor for Arbitrum (native units, default: 0.0005)' },
    // Per-chain RPC block-age tolerance (seconds) for the preflight RPC health
    // check. Tip stale beyond this fires FATAL non-zero exit. Defaults ~5×
    // chain block-time per RESEARCH Open Question 4.
    { name: 'ETH_BLOCK_AGE_TOLERANCE_SEC', required: false, description: 'Preflight RPC block-age tolerance in seconds for ETH (default: 300; FATAL when (now - block.timestamp) > this)' },
    { name: 'BSC_BLOCK_AGE_TOLERANCE_SEC', required: false, description: 'Preflight RPC block-age tolerance in seconds for BSC (default: 60)' },
    { name: 'BASE_BLOCK_AGE_TOLERANCE_SEC', required: false, description: 'Preflight RPC block-age tolerance in seconds for Base (default: 30)' },
    { name: 'ARB_BLOCK_AGE_TOLERANCE_SEC', required: false, description: 'Preflight RPC block-age tolerance in seconds for Arbitrum (default: 30)' },
    // Mid-run wallet-balance re-check interval per D-MID-RUN-CHECK (consumed
    // by Plan 20-04 setInterval wiring; registered now for D-ENV-EXAMPLE).
    { name: 'MID_RUN_CHECK_INTERVAL_SEC', required: false, description: 'Periodic mid-run wallet re-check interval in seconds (default: 300 = 5 min)' },
    // Stale-data warning + error thresholds per D-STALE-THRESHOLDS.
    { name: 'STALE_WARN_SEC', required: false, description: 'Stale-position warn-threshold age in seconds (default: 120 = 2 min)' },
    { name: 'STALE_ERROR_SEC', required: false, description: 'Stale-position error-threshold age in seconds (default: 600 = 10 min)' },
    // Dashboard URL — consumed by Plan 20-05 operator CLI scripts (pause/resume).
    { name: 'DASHBOARD_URL', required: false, description: 'Dashboard URL for operator CLI scripts (default: derived from DASHBOARD_HOST:DASHBOARD_PORT, e.g. http://127.0.0.1:8080)' },

    // --- MEV inclusion-reconciliation (Phase 21.1, STOP-THE-LINE-02) ---
    // Per D-ENV-EXAMPLE [USER-BINDING]: every var here also lives in .env.example
    // with default + 1-line inline-comment description. All required: false — the
    // bot runs unchanged with all unset (RESEARCH §Q7 generous-but-safe defaults).
    // GLOBAL (non-chain-prefixed) names: these are submission-mechanism knobs, not
    // per-chain trading params, so they match MID_RUN_CHECK_INTERVAL_SEC /
    // STALE_WARN_SEC rather than the per-chain ETH_* anti-rug pattern (RESEARCH A4).
    // Consumed by the shared submitWithReconciliation helper via buildReconcileConfig
    // (src/utils/mevStrategies/reconciliation.ts); strategies build cfg from these in 21.1-04.
    { name: 'MEV_CONFIRM_WINDOW_MS', required: false, description: 'Bounded confirm-window (ms) to poll receipt+nonce before declaring a bundle genuinely not-landed (~3-4 ETH blocks; generous per D-QUALITY-FIRST) (default: 45000)' },
    { name: 'MEV_CONFIRM_POLL_MS', required: false, description: 'Poll interval (ms) within the confirm-window (default: 4000)' },
    { name: 'MEV_MAX_PRIORITY_FEE_GWEI', required: false, description: 'Hard absolute ceiling on escalated maxPriorityFeePerGas (gwei); load-bearing safety cap (default: 5)' },
    { name: 'MEV_PRIORITY_FEE_STEP_GWEI', required: false, description: 'Per-retry priority-fee escalation step (gwei), clamped to the ceiling + affordability bound (default: 1)' },
    { name: 'MEV_RESERVE_SELL_GAS', required: false, description: 'When true, the affordability bound always reserves sellGasLimit x fee so the exit leg can submit (default: true)' },

    // --- Exit-engine robustness (Phase 21.2, Finding B layer 3 — STOP-THE-LINE-04-B) ---
    // GLOBAL (non-chain-prefixed) liveness knobs. CODE-read config, NOT secrets —
    // never log their values as secrets. Read via the never-NaN/never-negative
    // parsePositiveInt discipline (reconciliation.ts:564). Registered here so plan
    // 21.2-09 (watchdog + two-stage SIGINT) consumes them without re-touching config.ts.
    { name: 'RPC_TIMEOUT_MS', required: false, description: 'Per-provider/RPC-call wall-clock timeout (ms); Promise.race frees a hung call. Finding B. (default: 15000)' },
    { name: 'WATCHDOG_BUDGET_MS', required: false, description: 'Watchdog wall-clock budget per submit/cycle (ms); must exceed one 45s confirm-window + margin. Finding B. (default: 60000)' },
    { name: 'SIGINT_GRACE_MS', required: false, description: 'Two-stage SIGINT grace period (ms) before force-exit. Finding B. (default: 8000)' },

    // --- Calm-gas sell inclusion (Phase 21.2, Finding A — STOP-THE-LINE-04-A) ---
    // GLOBAL (non-chain-prefixed) sell-leg inclusion knobs. CODE-read config, NOT
    // secrets — never log their values as secrets. Read via the never-NaN /
    // never-negative parse helpers in consuming code (reconciliation.ts:642). All
    // four Finding A knobs are co-located here so 21.2-06 (inclusion ladder) and
    // 21.2-08 (entry affordability gate) consume them WITHOUT re-touching config.ts.
    { name: 'MEV_SELL_MAX_PRIORITY_FEE_GWEI', required: false, description: 'Independent SELL-leg priority-fee ceiling (gwei), decoupled from the buy ceiling, still affordability-clamped. Finding A. (default: 25)' },
    { name: 'MEV_SELL_COINBASE_BRIBE_ENABLED', required: false, description: 'RESERVED / NOT-YET-WIRED (IN-01, 21.2-13): a coinbase-bribe exit bundle is not implemented — this knob is read NOWHERE in src/ and has NO effect today. The public-mempool fallback is the guaranteed inclusion lever (Finding A). Left registered for a future plan; do not rely on it. (default: false)' },
    { name: 'EXIT_GATE_SELL_GAS_BUFFER', required: false, description: 'Multiplier on base fee when reserving worst-case public-exit gas for the buy-time affordability gate. Finding A. (default: 2.0)' },
    { name: 'MEV_SELL_FALLBACK_ATTEMPTS', required: false, description: 'Routine (non-anti-rug) private sell attempts before the public-mempool fallback; anti-rug uses 0-1. Finding A. (default: 2)' },
    { name: 'MEV_SELL_ANTIRUG_SLIPPAGE_PCT', required: false, description: 'WIDER public-fallback slippage (%) for anti-rug exits to maximize landing while liquidity drains; routine fallbacks reuse the configured exit slippage. Finding A. (default: 15)' },

    // --- Failed-exit position protection (Phase 21.2, Finding D — STOP-THE-LINE-04-D) ---
    // GLOBAL (non-chain-prefixed) balance-truth teardown knobs. CODE-read config,
    // NOT secrets. Read via the never-NaN/never-negative parse helpers in
    // consuming code (exitEngine.ts). These gate the capital-safety invariant: a
    // failed exit of a STILL-HELD position keeps anti-rug + the poll timer rather
    // than tearing down. Registered here so 21.2-07 (balance-truth catch) consumes
    // them WITHOUT re-touching config.ts.
    { name: 'EXIT_DUST_THRESHOLD_BPS', required: false, description: 'Dust threshold (basis points of the original token amount) at/under which a re-fetched balanceOf is treated as a GENUINE close → teardown; above it the position is STILL HELD → keep anti-rug + re-arm the poll timer. Relative + a tiny absolute floor. Finding D. (default: 1 = 0.01%)' },
    { name: 'EXIT_ROUTINE_MAX_FAILURES', required: false, description: 'Consecutive ROUTINE (non-anti-rug) failed-exit count after which routine retries pause + hard-alert; anti-rug emergency exits ALWAYS bypass the pause and fire. Finding D. (default: 5)' },
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
