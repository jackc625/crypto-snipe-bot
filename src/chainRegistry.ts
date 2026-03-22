// src/chainRegistry.ts
// Single source of truth for all chain-specific configuration (D-01).
// Maps chain names to typed ChainConfig with RPC, DEX, MEV, safety, gas settings.
import { ethers, JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import type pino from 'pino';
import { logger } from './utils/logger';
import { getProvider, getWsProvider } from './utils/provider';

const log = logger.child({ module: 'chainRegistry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DexConfig {
    name: string;           // 'uniswap-v2', 'sushiswap-v2', 'pancakeswap-v2', 'biswap-v2', 'aerodrome', 'camelot-v2'
    factoryAddress: string;
    routerAddress: string;
}

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
    gas: GasConfig;
    snipeAmount: string;
    maxCapital: string;
    explorerUrl: string;
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
    httpRpcEnv: string;
    wsRpcEnv: string;
}

const CHAIN_TEMPLATES: Record<string, ChainTemplate> = {
    eth: {
        chainId: 1,
        name: 'eth',
        displayName: '[ETH]',
        nativeCurrency: 'ETH',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        dexes: [
            {
                name: 'uniswap-v2',
                factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
                routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
            },
            {
                name: 'sushiswap-v2',
                factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
                routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
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
        httpRpcEnv: 'ETH_RPC_URL',
        wsRpcEnv: 'ETH_WS_URL',
    },
    bsc: {
        chainId: 56,
        name: 'bsc',
        displayName: '[BSC]',
        nativeCurrency: 'BNB',
        wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        dexes: [
            {
                name: 'pancakeswap-v2',
                factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
                routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            },
            {
                name: 'biswap-v2',
                factoryAddress: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE',
                routerAddress: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
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
        httpRpcEnv: 'BSC_RPC_URL',
        wsRpcEnv: 'BSC_WS_URL',
    },
    base: {
        chainId: 8453,
        name: 'base',
        displayName: '[BASE]',
        nativeCurrency: 'ETH',
        wethAddress: '0x4200000000000000000000000000000000000006',
        dexes: [
            {
                name: 'uniswap-v2',
                factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
                routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
            },
            {
                name: 'aerodrome',
                factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
                routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
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
        httpRpcEnv: 'BASE_RPC_URL',
        wsRpcEnv: 'BASE_WS_URL',
    },
    arb: {
        chainId: 42161,
        name: 'arb',
        displayName: '[ARB]',
        nativeCurrency: 'ETH',
        wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        dexes: [
            {
                name: 'uniswap-v2',
                factoryAddress: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
                routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
            },
            {
                name: 'camelot-v2',
                factoryAddress: '0x6EcCab422D763aC031210895C81787E87B43A652',
                routerAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
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
        httpRpcEnv: 'ARB_RPC_URL',
        wsRpcEnv: 'ARB_WS_URL',
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
            gas: template.gas,
            snipeAmount,
            maxCapital,
            explorerUrl: template.explorerUrl,
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
