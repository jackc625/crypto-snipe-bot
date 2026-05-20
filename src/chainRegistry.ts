// src/chainRegistry.ts
// Single source of truth for all chain-specific configuration (D-01).
// Maps chain names to typed ChainConfig with RPC, DEX, MEV, safety, gas settings.
import { ethers, JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import type pino from 'pino';
import { logger } from './utils/logger';
import { getProvider, getWsProvider } from './utils/provider';
import type { HoneypotCheckerConfig } from './utils/honeypot/types';

// Plan 18-06 Task 1: re-export so other modules can import HoneypotCheckerConfig
// from the chain-registry source of truth (matching the SafetyApiConfig /
// GasConfig pattern). Plan 18-02 ships the canonical declaration in
// src/utils/honeypot/types.ts; this re-export keeps a single import target.
export type { HoneypotCheckerConfig };

const log = logger.child({ module: 'chainRegistry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DexConfigBase {
    name: string;
    factoryAddress: string;
}

export interface DexConfigV2 extends DexConfigBase {
    dexType: 'v2';
    routerAddress: string;
}

export interface DexConfigV3 extends DexConfigBase {
    dexType: 'v3';
    swapRouterAddress: string;
    quoterAddress: string;
}

export type DexConfig = DexConfigV2 | DexConfigV3;

export interface SafetyApiConfig {
    honeypot: 'honeypot.is' | 'goplus';
    liquidityLock: 'unicrypt' | 'mudra' | 'goplus';
    tokenSecurity: 'goplus';
}

export type MevStrategyType = 'flashbots' | 'bloxroute' | 'passthrough';

export interface GasConfig {
    type: 'eip1559' | 'legacy';
    multiplier: number;
    maxGasLimit: bigint;
}

export interface ChainConfig {
    chainId: number;
    name: string;                    // 'eth', 'bsc', 'base', 'arb'
    displayName: string;             // '[ETH]', '[BSC]', '[BASE]', '[ARB]'
    enabled: boolean;
    nativeCurrency: string;          // 'ETH', 'BNB', 'ETH', 'ETH'
    wethAddress: string;
    httpRpcUrl: string;
    wsRpcUrl: string | null;
    dexes: DexConfig[];
    mevStrategy: MevStrategyType;
    mevConfig: Record<string, string>;
    safetyApis: SafetyApiConfig;
    // Plan 18-06 HONEY-05: per-chain HoneypotChecker contract config
    // (deployedAddress + dispatch method + tax-threshold bps).
    // Plan 18-02 introduced this as an optional declaration-merge augmentation
    // in src/utils/honeypot/index.ts; plan 18-06 promotes the field to a
    // required member on the source-of-truth interface so downstream code
    // can read ctx.chain.honeypotChecker.{deployedAddress, method,
    // maxBuyTaxBps, maxSellTaxBps} without optional chaining.
    honeypotChecker: HoneypotCheckerConfig;
    gas: GasConfig;
    snipeAmount: string;
    maxCapital: string;
    explorerUrl: string;
    minLiquidityThreshold: string;
}

export interface ChainContext {
    chain: ChainConfig;
    httpProvider: JsonRpcProvider;
    wsProvider: WebSocketProvider | null;
    wallet: Wallet;
    log: pino.Logger;
}

// ---------------------------------------------------------------------------
// Static chain templates (contract addresses + defaults are hardcoded per D-02)
// ---------------------------------------------------------------------------

interface ChainTemplate {
    chainId: number;
    name: string;
    displayName: string;
    nativeCurrency: string;
    wethAddress: string;
    dexes: DexConfig[];
    mevStrategy: MevStrategyType;
    staticMevConfig: Record<string, string>;
    safetyApis: SafetyApiConfig;
    gas: GasConfig;
    explorerUrl: string;
    envPrefix: string;
    defaultSnipeAmount: string;
    defaultMaxCapital: string;
    defaultMinLiquidityThreshold: string;
    httpRpcEnv: string;
    wsRpcEnv: string;
    // Plan 18-06: per-chain HoneypotChecker defaults. The deployed contract
    // address is supplied at runtime via <PREFIX>_HONEYPOT_CHECKER_ADDRESS,
    // falling back to the literal `defaultHoneypotCheckerAddress` committed
    // here (iter-2 Blocker #3 — canonical source-of-truth lives in the
    // source file; env var is an operator OVERRIDE for hot-patching).
    // `null` until the chain's contract is deployed (plans 18-07/18-08).
    honeypotMethod: 'on-chain-contract' | 'eth_simulateV1';
    defaultMaxBuyTaxBps: number;
    defaultMaxSellTaxBps: number;
    defaultHoneypotCheckerAddress: string | null;
}

// Exported for test/integration/honeypotDeploy.*.test.ts (plan 18-07/18-08) so
// the integration tests can read the canonical literal address without going
// through buildChainRegistry() (which requires ENABLED_CHAINS / FLASHBOTS_AUTH_KEY
// / etc. validation to fire).
export const CHAIN_TEMPLATES: Record<string, ChainTemplate> = {
    eth: {
        chainId: 1,
        name: 'eth',
        displayName: '[ETH]',
        nativeCurrency: 'ETH',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        dexes: [
            {
                dexType: 'v2',
                name: 'uniswap-v2',
                factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
                routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
            },
            {
                dexType: 'v2',
                name: 'sushiswap-v2',
                factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
                routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
            },
            {
                dexType: 'v3',
                name: 'uniswap-v3',
                factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                swapRouterAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
                quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            },
        ],
        mevStrategy: 'flashbots',
        staticMevConfig: { relayUrl: 'https://relay.flashbots.net', network: 'mainnet' },
        safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
        gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
        explorerUrl: 'https://etherscan.io',
        envPrefix: 'ETH',
        defaultSnipeAmount: '0.01',
        defaultMaxCapital: '1.0',
        defaultMinLiquidityThreshold: '0.5',
        httpRpcEnv: 'ETH_RPC_URL',
        wsRpcEnv: 'ETH_WS_URL',
        honeypotMethod: 'on-chain-contract',
        defaultMaxBuyTaxBps: 1000,
        defaultMaxSellTaxBps: 1000,
        // Plan 18-07 (HONEY-03) iter-2 Blocker #3: canonical ETH HoneypotChecker
        // address deployed via Hardhat Ignition on 2026-05-19; Etherscan-verified
        // (V2 + V3 entry points). Committed as literal default per the audit-trail
        // requirement that the source-of-truth lives in the source file; the
        // ETH_HONEYPOT_CHECKER_ADDRESS env var remains as an operator override
        // for hot-patching without redeploy. See
        // .planning/milestones/v6.17-honeypot-checker-audit.md §HONEY-03.
        defaultHoneypotCheckerAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
    },
    bsc: {
        chainId: 56,
        name: 'bsc',
        displayName: '[BSC]',
        nativeCurrency: 'BNB',
        wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        dexes: [
            {
                dexType: 'v2',
                name: 'pancakeswap-v2',
                factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
                routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            },
            {
                dexType: 'v2',
                name: 'biswap-v2',
                factoryAddress: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE',
                routerAddress: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
            },
            {
                dexType: 'v3',
                name: 'uniswap-v3',
                factoryAddress: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
                swapRouterAddress: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
                quoterAddress: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
            },
            {
                dexType: 'v3',
                name: 'pancakeswap-v3',
                factoryAddress: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
                swapRouterAddress: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
                quoterAddress: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
            },
        ],
        mevStrategy: 'bloxroute',
        staticMevConfig: { endpoint: 'https://api.blxrbdn.com' },
        safetyApis: { honeypot: 'goplus', liquidityLock: 'mudra', tokenSecurity: 'goplus' },
        gas: { type: 'legacy', multiplier: 1.1, maxGasLimit: 500_000n },
        explorerUrl: 'https://bscscan.com',
        envPrefix: 'BSC',
        defaultSnipeAmount: '0.05',
        defaultMaxCapital: '5.0',
        defaultMinLiquidityThreshold: '1.0',
        httpRpcEnv: 'BSC_RPC_URL',
        wsRpcEnv: 'BSC_WS_URL',
        honeypotMethod: 'on-chain-contract',
        defaultMaxBuyTaxBps: 1000,
        defaultMaxSellTaxBps: 1000,
        // Plan 18-08 (HONEY-04) will populate after 2-3 day observation window
        // from plan 18-07 closes cleanly.
        defaultHoneypotCheckerAddress: null,
    },
    base: {
        chainId: 8453,
        name: 'base',
        displayName: '[BASE]',
        nativeCurrency: 'ETH',
        wethAddress: '0x4200000000000000000000000000000000000006',
        dexes: [
            {
                dexType: 'v2',
                name: 'uniswap-v2',
                factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
                routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
            },
            {
                dexType: 'v2',
                name: 'aerodrome',
                factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
                routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
            },
            {
                dexType: 'v3',
                name: 'uniswap-v3',
                factoryAddress: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
                swapRouterAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
                quoterAddress: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
            },
        ],
        mevStrategy: 'passthrough',
        staticMevConfig: {},
        safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'goplus', tokenSecurity: 'goplus' },
        gas: { type: 'eip1559', multiplier: 1.1, maxGasLimit: 500_000n },
        explorerUrl: 'https://basescan.org',
        envPrefix: 'BASE',
        defaultSnipeAmount: '0.005',
        defaultMaxCapital: '0.5',
        defaultMinLiquidityThreshold: '0.1',
        httpRpcEnv: 'BASE_RPC_URL',
        wsRpcEnv: 'BASE_WS_URL',
        honeypotMethod: 'on-chain-contract',
        defaultMaxBuyTaxBps: 1000,
        defaultMaxSellTaxBps: 1000,
        // Plan 18-08 (HONEY-04) will populate after 2-3 day observation window
        // from plan 18-07 closes cleanly.
        defaultHoneypotCheckerAddress: null,
    },
    arb: {
        chainId: 42161,
        name: 'arb',
        displayName: '[ARB]',
        nativeCurrency: 'ETH',
        wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        dexes: [
            {
                dexType: 'v2',
                name: 'uniswap-v2',
                factoryAddress: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
                routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
            },
            {
                dexType: 'v2',
                name: 'camelot-v2',
                factoryAddress: '0x6EcCab422D763aC031210895C81787E87B43A652',
                routerAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
            },
            {
                dexType: 'v3',
                name: 'uniswap-v3',
                factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                swapRouterAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
                quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            },
        ],
        mevStrategy: 'passthrough',
        staticMevConfig: {},
        safetyApis: { honeypot: 'goplus', liquidityLock: 'goplus', tokenSecurity: 'goplus' },
        gas: { type: 'eip1559', multiplier: 1.1, maxGasLimit: 1_000_000n },
        explorerUrl: 'https://arbiscan.io',
        envPrefix: 'ARB',
        defaultSnipeAmount: '0.005',
        defaultMaxCapital: '0.5',
        defaultMinLiquidityThreshold: '0.1',
        httpRpcEnv: 'ARB_RPC_URL',
        wsRpcEnv: 'ARB_WS_URL',
        honeypotMethod: 'on-chain-contract',
        defaultMaxBuyTaxBps: 1000,
        defaultMaxSellTaxBps: 1000,
        // Plan 18-08 (HONEY-04) will populate after 2-3 day observation window
        // from plan 18-07 closes cleanly.
        defaultHoneypotCheckerAddress: null,
    },
};

// Valid chain names for validation
const VALID_CHAIN_NAMES = Object.keys(CHAIN_TEMPLATES);

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

/**
 * Build the chain registry from environment variables and static chain templates.
 * Reads ENABLED_CHAINS, per-chain RPC URLs, capital settings, and MEV auth keys.
 * Validates that all required env vars are set for enabled chains.
 */
export function buildChainRegistry(): Map<string, ChainConfig> {
    const enabledRaw = (process.env.ENABLED_CHAINS || 'eth').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Validate chain names
    for (const name of enabledRaw) {
        if (!VALID_CHAIN_NAMES.includes(name)) {
            log.fatal({ chain: name, validChains: VALID_CHAIN_NAMES }, 'Unknown chain name in ENABLED_CHAINS');
            process.exit(1);
        }
    }

    const registry = new Map<string, ChainConfig>();

    for (const chainName of VALID_CHAIN_NAMES) {
        const template = CHAIN_TEMPLATES[chainName];
        const isEnabled = enabledRaw.includes(chainName);

        // Read per-chain env vars
        const httpRpcUrl = process.env[template.httpRpcEnv] || '';
        const wsRpcUrl = process.env[template.wsRpcEnv] || null;
        const snipeAmount = process.env[`${template.envPrefix}_SNIPE_AMOUNT`] || template.defaultSnipeAmount;
        const maxCapital = process.env[`${template.envPrefix}_MAX_CAPITAL`] || template.defaultMaxCapital;
        const minLiquidityThreshold = process.env[`${template.envPrefix}_MIN_LIQUIDITY`] || template.defaultMinLiquidityThreshold;

        // Plan 18-06 HONEY-05: per-chain HoneypotChecker overlay.
        //   <PREFIX>_HONEYPOT_CHECKER_ADDRESS — operator OVERRIDE for the
        //     literal `defaultHoneypotCheckerAddress` committed in
        //     CHAIN_TEMPLATES (plan 18-07 iter-2 Blocker #3 — canonical
        //     source-of-truth lives in the source file).
        //   Falls back to template default; null when neither is set
        //     (dispatch layer returns verdict='unknown' per D-UNKNOWN-POLICY).
        //   <PREFIX>_MAX_BUY_TAX_BPS, <PREFIX>_MAX_SELL_TAX_BPS — fail-loud
        //     validated in [0, 10000] bps. Default 1000 (10%) per
        //     D-TAX-THRESHOLDS.
        const honeypotCheckerAddress = process.env[`${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS`] || template.defaultHoneypotCheckerAddress;
        const maxBuyTaxBpsRaw = process.env[`${template.envPrefix}_MAX_BUY_TAX_BPS`] || String(template.defaultMaxBuyTaxBps);
        const maxSellTaxBpsRaw = process.env[`${template.envPrefix}_MAX_SELL_TAX_BPS`] || String(template.defaultMaxSellTaxBps);
        const maxBuyTaxBps = parseInt(maxBuyTaxBpsRaw, 10);
        const maxSellTaxBps = parseInt(maxSellTaxBpsRaw, 10);
        // Fail-loud (T-18-21 mitigation): a malformed bps env value silently
        // parsing as NaN would disable the threshold gate downstream.
        if (Number.isNaN(maxBuyTaxBps) || maxBuyTaxBps < 0 || maxBuyTaxBps > 10000) {
            log.fatal(
                { chain: chainName, key: `${template.envPrefix}_MAX_BUY_TAX_BPS`, value: maxBuyTaxBpsRaw },
                'Tax threshold env var must be a valid bps integer in [0, 10000]'
            );
            process.exit(1);
        }
        if (Number.isNaN(maxSellTaxBps) || maxSellTaxBps < 0 || maxSellTaxBps > 10000) {
            log.fatal(
                { chain: chainName, key: `${template.envPrefix}_MAX_SELL_TAX_BPS`, value: maxSellTaxBpsRaw },
                'Tax threshold env var must be a valid bps integer in [0, 10000]'
            );
            process.exit(1);
        }

        // For ETH, fall back to ALCHEMY_URL if ETH_RPC_URL is not set (backward compat)
        let resolvedHttpRpcUrl = httpRpcUrl;
        if (chainName === 'eth' && !resolvedHttpRpcUrl && process.env.ALCHEMY_URL) {
            resolvedHttpRpcUrl = process.env.ALCHEMY_URL;
        }

        // Validate required env vars for enabled chains
        if (isEnabled) {
            if (!resolvedHttpRpcUrl) {
                log.fatal({ chain: chainName, envVar: template.httpRpcEnv }, 'Missing HTTP RPC URL for enabled chain');
                process.exit(1);
            }

            // MEV auth validation
            if (template.mevStrategy === 'flashbots' && !process.env.FLASHBOTS_AUTH_KEY) {
                log.fatal({ chain: chainName }, 'Missing FLASHBOTS_AUTH_KEY for Flashbots-enabled chain');
                process.exit(1);
            }
            if (template.mevStrategy === 'bloxroute' && !process.env.BLOXROUTE_AUTH_HEADER) {
                log.fatal({ chain: chainName }, 'Missing BLOXROUTE_AUTH_HEADER for bloXroute-enabled chain');
                process.exit(1);
            }
        }

        // Build MEV config with dynamic auth keys
        const mevConfig: Record<string, string> = { ...template.staticMevConfig };
        if (template.mevStrategy === 'flashbots' && process.env.FLASHBOTS_AUTH_KEY) {
            mevConfig.authKey = process.env.FLASHBOTS_AUTH_KEY;
        }
        if (template.mevStrategy === 'bloxroute' && process.env.BLOXROUTE_AUTH_HEADER) {
            mevConfig.authHeader = process.env.BLOXROUTE_AUTH_HEADER;
        }

        const chainConfig: ChainConfig = {
            chainId: template.chainId,
            name: template.name,
            displayName: template.displayName,
            enabled: isEnabled,
            nativeCurrency: template.nativeCurrency,
            wethAddress: template.wethAddress,
            httpRpcUrl: resolvedHttpRpcUrl,
            wsRpcUrl: wsRpcUrl || null,
            dexes: template.dexes,
            mevStrategy: template.mevStrategy,
            mevConfig,
            safetyApis: template.safetyApis,
            honeypotChecker: {
                deployedAddress: honeypotCheckerAddress,
                method: template.honeypotMethod,
                maxBuyTaxBps,
                maxSellTaxBps,
            },
            gas: template.gas,
            snipeAmount,
            maxCapital,
            explorerUrl: template.explorerUrl,
            minLiquidityThreshold,
        };

        registry.set(chainName, chainConfig);
    }

    const enabledChains = [...registry.values()].filter(c => c.enabled);
    log.info(
        { enabledChains: enabledChains.map(c => c.name), totalChains: registry.size },
        'Chain registry built'
    );

    return registry;
}

// ---------------------------------------------------------------------------
// Convenience accessors
// ---------------------------------------------------------------------------

/**
 * Return array of ChainConfig where enabled === true.
 */
export function getEnabledChains(registry: Map<string, ChainConfig>): ChainConfig[] {
    return [...registry.values()].filter(c => c.enabled);
}

/**
 * Create a ChainContext for a given chain config.
 * Provides HTTP/WS providers, wallet, and a chain-scoped pino logger.
 */
export function createChainContext(chain: ChainConfig): ChainContext {
    const httpProvider = getProvider(chain.name, chain.httpRpcUrl);
    const wsProvider = getWsProvider(chain.name, chain.wsRpcUrl, chain.chainId);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, httpProvider);
    const chainLog = logger.child({ chain: chain.name });

    return {
        chain,
        httpProvider,
        wsProvider,
        wallet,
        log: chainLog,
    };
}

// ---------------------------------------------------------------------------
// Type guards for DexConfig discriminated union
// ---------------------------------------------------------------------------

export function isDexV2(dex: DexConfig): dex is DexConfigV2 {
    return dex.dexType === 'v2';
}

export function isDexV3(dex: DexConfig): dex is DexConfigV3 {
    return dex.dexType === 'v3';
}
