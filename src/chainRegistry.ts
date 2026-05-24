// src/chainRegistry.ts
// Single source of truth for all chain-specific configuration (D-01).
// Maps chain names to typed ChainConfig with RPC, DEX, MEV, safety, gas settings.
import { ethers, JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import type pino from 'pino';
import { logger } from './utils/logger';
import { getProvider, getWsProvider } from './utils/provider';
import type { HoneypotCheckerConfig } from './utils/honeypot/types';
import type { AllowlistEntry, AntiRugConfig } from './anti-rug/types';

// Plan 18-06 Task 1: re-export so other modules can import HoneypotCheckerConfig
// from the chain-registry source of truth (matching the SafetyApiConfig /
// GasConfig pattern). Plan 18-02 ships the canonical declaration in
// src/utils/honeypot/types.ts; this re-export keeps a single import target.
export type { HoneypotCheckerConfig };

// Plan 19-03 Task 1: re-export AllowlistEntry + AntiRugConfig from the
// src/anti-rug/types.ts source of truth. Plan 19-02 declared these inline
// here as a forward-compat shim while src/anti-rug/ did not yet exist; Plan
// 19-03 hoists the canonical declaration into the anti-rug module and this
// file now imports the types (matching the HoneypotCheckerConfig precedent
// above). Re-export preserves all existing import sites that previously
// pulled `AllowlistEntry` / `AntiRugConfig` from `./chainRegistry` (single
// migration point + no downstream import churn).
export type { AllowlistEntry, AntiRugConfig };

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
    // Plan 19-02 (Phase 19 anti-rug runtime monitoring): per-chain anti-rug
    // tuning fields + hardcoded + env-overlay locker allowlists. Required
    // field per the must_haves contract; defaults supplied by CHAIN_TEMPLATES
    // with per-chain env overrides validated fail-loud.
    antiRug: AntiRugConfig;
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
    // Plan 19-02: per-chain anti-rug defaults. ETH has a distinct
    // backfillCapBlocks default (10, Alchemy free-tier safe per
    // 19-RESEARCH.md CRITICAL #1); BSC/BASE/ARB default to 500.
    // All other defaults are uniform across chains.
    defaultAntiRugLpRemovalPct: number;
    defaultAntiRugConfirmBlocks: number;
    defaultAntiRugCircuitBreakerTriggers: number;
    defaultAntiRugCircuitBreakerWindowHours: number;
    defaultAntiRugGasMultiplier: number;
    defaultAntiRugBackfillCapBlocks: number;
    defaultAntiRugMaxBackfillBlocks: number;
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
        // Plan 19-02 anti-rug defaults for ETH. backfillCapBlocks=10 is the
        // Alchemy free-tier safe value per 19-RESEARCH.md CRITICAL #1.
        defaultAntiRugLpRemovalPct: 50,
        defaultAntiRugConfirmBlocks: 1,
        defaultAntiRugCircuitBreakerTriggers: 3,
        defaultAntiRugCircuitBreakerWindowHours: 1,
        defaultAntiRugGasMultiplier: 2.0,
        defaultAntiRugBackfillCapBlocks: 10,
        defaultAntiRugMaxBackfillBlocks: 7200,
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
        // Plan 19-02 anti-rug defaults for BSC. backfillCapBlocks=500 is the
        // conservative-safe default for public BSC RPCs / Chainstack.
        defaultAntiRugLpRemovalPct: 50,
        defaultAntiRugConfirmBlocks: 1,
        defaultAntiRugCircuitBreakerTriggers: 3,
        defaultAntiRugCircuitBreakerWindowHours: 1,
        defaultAntiRugGasMultiplier: 2.0,
        defaultAntiRugBackfillCapBlocks: 500,
        defaultAntiRugMaxBackfillBlocks: 7200,
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
        // Plan 19-02 anti-rug defaults for Base. backfillCapBlocks=500 is the
        // conservative-safe default for public Base RPCs.
        defaultAntiRugLpRemovalPct: 50,
        defaultAntiRugConfirmBlocks: 1,
        defaultAntiRugCircuitBreakerTriggers: 3,
        defaultAntiRugCircuitBreakerWindowHours: 1,
        defaultAntiRugGasMultiplier: 2.0,
        defaultAntiRugBackfillCapBlocks: 500,
        defaultAntiRugMaxBackfillBlocks: 7200,
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
        // Plan 19-02 anti-rug defaults for Arbitrum. backfillCapBlocks=500 is
        // the conservative-safe default for public Arb RPCs.
        defaultAntiRugLpRemovalPct: 50,
        defaultAntiRugConfirmBlocks: 1,
        defaultAntiRugCircuitBreakerTriggers: 3,
        defaultAntiRugCircuitBreakerWindowHours: 1,
        defaultAntiRugGasMultiplier: 2.0,
        defaultAntiRugBackfillCapBlocks: 500,
        defaultAntiRugMaxBackfillBlocks: 7200,
    },
};

// ---------------------------------------------------------------------------
// Plan 19-02: Hardcoded V2 + V3 locker allowlists per chain
//
// Source-of-truth for known-safe LP-removal destinations. Addresses verified
// in 19-RESEARCH.md §2.1 (V2 lockers) and §2.2 (V3 lockers). Every entry is
// wrapped in ethers.getAddress(...) which validates checksum at module load
// (T-19-02-01 mitigation — typo throws at boot).
//
// TeamFinance V3 NFT vault + PinkLock V3 — D-V3-ALLOWLIST [USER-BINDING]
// resolution (plan 19-02 Task 3, completed 2026-05-23):
//
//   ETH (enabled):
//     TeamFinance V3 NFT vault → `0xe2fe530c047f2d85298b07d9333c05737f1435fb`
//       — same Gnosis-admined proxy as the V2 entry. TrustSwap blog ("Uniswap V3
//       is now supported by Team Finance") confirms the existing locker proxy
//       was upgraded to handle V3 NFT positions without changing the user-
//       facing address. Listed in BOTH V2 and V3 allowlists below.
//     PinkLock V3 → does NOT exist on Ethereum mainnet. On-chain ABI inspection
//       of both PinkLock contracts (0x71b5759d…57641 PinkLock02 and
//       0x33d4cc…5e2a older PinkLock) via Etherscan API on 2026-05-23 shows
//       zero V3/NFT signatures (no `lockNFT`, no `onERC721Received`, no
//       `tokenId` parameters — both are pure ERC20-LP-token lockers).
//       PinkSale documentation only references V3 for BSC. Documented inline
//       as `// OPERATOR-VERIFIED-NO-PINKLOCK-V3-eth` below.
//
//   BSC / BASE / ARB (not enabled): operator decision deferred — these
//     chains retain PHASE-19-BLOCKER-4-ESCALATION comments below; Plan 19-08
//     surfaces them in the Wave-1 follow-up table for resolution before any
//     of those chains is enabled.
// ---------------------------------------------------------------------------

const DEAD_ADDRESS = ethers.getAddress('0x000000000000000000000000000000000000dEaD');

const HARDCODED_V2_ALLOWLIST: Record<string, AllowlistEntry[]> = {
    eth: [
        {
            address: ethers.getAddress('0x59d7d55ddc58494fbbbca29904f108ece82ac7fb'),
            lockerName: 'Unicrypt UniLockerV2 ETH',
            provenance: 'hardcoded',
        },
        {
            address: ethers.getAddress('0xe2fe530c047f2d85298b07d9333c05737f1435fb'),
            lockerName: 'TeamFinance / TrustSwap Lock ETH',
            provenance: 'hardcoded',
        },
        {
            address: ethers.getAddress('0x71b5759d73262fbb223956913ecf4ecc51057641'),
            lockerName: 'PinkLock V2 ETH',
            provenance: 'hardcoded',
        },
        {
            address: DEAD_ADDRESS,
            lockerName: '0xdEaD burn address (universal)',
            provenance: 'hardcoded',
        },
    ],
    bsc: [
        {
            address: ethers.getAddress('0xC765bddB93b0D1c1A88282BA0fa6B2d00E3e0c83'),
            lockerName: 'UNCX UniLockerV2 BSC (PancakeSwap V2)',
            provenance: 'hardcoded',
        },
        {
            address: ethers.getAddress('0x407993575c91ce7643a4d4ccacc9a98c36ee1bbe'),
            lockerName: 'PinkLock V2 BSC',
            provenance: 'hardcoded',
        },
        {
            address: DEAD_ADDRESS,
            lockerName: '0xdEaD burn address (universal)',
            provenance: 'hardcoded',
        },
    ],
    base: [
        {
            address: ethers.getAddress('0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB'),
            lockerName: 'UNCX UniLockerV2 Base (Uniswap V2)',
            provenance: 'hardcoded',
        },
        {
            address: DEAD_ADDRESS,
            lockerName: '0xdEaD burn address (universal)',
            provenance: 'hardcoded',
        },
    ],
    arb: [
        {
            address: ethers.getAddress('0x63F4B2C082B1E0bbA38874567E053800379bF8D7'),
            lockerName: 'UNCX UniLockerV2 Arbitrum (Uniswap V2)',
            provenance: 'hardcoded',
        },
        {
            address: DEAD_ADDRESS,
            lockerName: '0xdEaD burn address (universal)',
            provenance: 'hardcoded',
        },
    ],
};

const HARDCODED_V3_ALLOWLIST: Record<string, AllowlistEntry[]> = {
    eth: [
        {
            address: ethers.getAddress('0xFD235968e65B0990584585763f837A5b5330e6DE'),
            lockerName: 'UNCX V3 Locker ETH (NFT-holding)',
            provenance: 'hardcoded',
        },
        {
            // D-V3-ALLOWLIST [USER-BINDING] Task-3 resolution (2026-05-23):
            // Same Gnosis-admined proxy as the TeamFinance V2 entry. The
            // existing locker contract was upgraded to handle Uniswap V3
            // NonfungiblePositionManager NFTs without changing the user-facing
            // address. Reference: TrustSwap blog "Uniswap V3 is now supported
            // by Team Finance" (https://trustswap.com/blog/uniswap-v3/).
            address: ethers.getAddress('0xe2fe530c047f2d85298b07d9333c05737f1435fb'),
            lockerName: 'TeamFinance / TrustSwap Lock ETH (V2 + V3 unified proxy)',
            provenance: 'hardcoded',
        },
        // OPERATOR-VERIFIED-NO-PINKLOCK-V3-eth (2026-05-23):
        //   PinkLock V3 does NOT exist on Ethereum mainnet. On-chain ABI
        //   inspection of both PinkLock contracts on ETH via Etherscan API:
        //     0x71b5759d73262fbb223956913ecf4ecc51057641 (PinkLock02) and
        //     0x33d4cc8716beb13f814f538ad3b2de3b036f5e2a (older PinkLock)
        //   — neither contract has any V3/NFT-related function signatures
        //   (no lockNFT, no onERC721Received hook, no tokenId parameter).
        //   Both contracts are pure ERC20 LP-token lockers. PinkSale's
        //   own documentation (https://docs.pinksale.finance/pinklock)
        //   only references V3 functionality on BSC, never on Ethereum.
        //   Conclusion: no PinkLock V3 ETH entry is needed; this is not a
        //   gap to track — it's a verified absence.
    ],
    bsc: [
        {
            address: ethers.getAddress('0xfe88DAB083964C56429baa01F37eC2265AbF1557'),
            lockerName: 'UNCX V3 Locker BSC',
            provenance: 'hardcoded',
        },
        // PHASE-19-BLOCKER-4-ESCALATION: see eth comment above (TeamFinance V3
        //   + PinkLock V3 BSC addresses pending operator resolution in Task 3).
    ],
    base: [
        {
            address: ethers.getAddress('0x231278eDd38B00B07fBd52120CEf685B9BaEBCC1'),
            lockerName: 'UNCX V3 Locker Base',
            provenance: 'hardcoded',
        },
        // PHASE-19-BLOCKER-4-ESCALATION: see eth comment above (TeamFinance V3
        //   + PinkLock V3 Base addresses pending operator resolution in Task 3).
    ],
    arb: [
        {
            address: ethers.getAddress('0x6b5360B419e0851b4b81644e0F63c1A9778f2506'),
            lockerName: 'UNCX V3 Locker Arbitrum',
            provenance: 'hardcoded',
        },
        {
            // ANTIRUG-15: UNCX V3 "Proof of Reserves 2" on Arbitrum (distinct
            // contract from the standard UNCX V3 Locker; verified via
            // Arbiscan token-tag search per 19-RESEARCH.md §2.2).
            address: ethers.getAddress('0xcb8b00d4018ad6031e28a44bf74616014bfb62ec'),
            lockerName: 'UNCX V3 "Proof of Reserves 2" Arbitrum (ANTIRUG-15)',
            provenance: 'hardcoded',
        },
        // PHASE-19-BLOCKER-4-ESCALATION: see eth comment above (TeamFinance V3
        //   + PinkLock V3 Arbitrum addresses pending operator resolution in
        //   Task 3).
    ],
};

// Plan 19-03 imports these for the startup-time getCode() check + the
// allowlist-merge logic. Re-export for downstream module consumption.
export { HARDCODED_V2_ALLOWLIST, HARDCODED_V3_ALLOWLIST };

/**
 * Merge the hardcoded base allowlist with the operator's env-overlay extras.
 * Plan 19-02: dedupe by lowercased address (operator overlay takes precedence
 * for the lockerName/provenance fields if the same address appears in both,
 * but this is reported in the SUMMARY for operator awareness — the merge
 * does NOT silently de-dupe with a no-op; an exact-address duplicate ships as
 * one entry with provenance='env-overlay').
 */
function mergeAllowlist(
    base: AllowlistEntry[],
    extras: AllowlistEntry[],
): AllowlistEntry[] {
    const merged = new Map<string, AllowlistEntry>();
    for (const e of base) {
        merged.set(e.address.toLowerCase(), e);
    }
    // Extras overwrite same-address hardcoded entries (operator intent wins).
    // WR-01: when an env-overlay entry replaces a hardcoded entry, structured-
    // log the override so the audit trail captures the operator's intent
    // (previously the override happened silently — the dead `mergeAllowlist`
    // export in anti-rug/allowlist.ts preserved BOTH rows for audit, but
    // production used this dedupe path which dropped the hardcoded row).
    for (const e of extras) {
        const lc = e.address.toLowerCase();
        const prior = merged.get(lc);
        if (prior && prior.provenance !== e.provenance) {
            logger.warn(
                {
                    address: e.address,
                    overriddenLockerName: prior.lockerName,
                    overriddenProvenance: prior.provenance,
                    overrideLockerName: e.lockerName,
                    overrideProvenance: e.provenance,
                    op: 'antirug.allowlist.env-override-hardcoded',
                },
                'Anti-rug allowlist env-overlay entry overrode hardcoded entry — operator intent retained',
            );
        }
        merged.set(lc, e);
    }
    return [...merged.values()];
}

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

        // -------------------------------------------------------------------
        // Plan 19-02: per-chain anti-rug env overlay + fail-loud validation
        // Pattern mirrors chainRegistry.ts:376-389 (Phase 18 max-buy-tax-bps
        // validator). Invalid env values FATAL-exit per T-19-02-04 mitigation.
        // -------------------------------------------------------------------
        const antiRugLiveExecuteRaw = process.env[`${template.envPrefix}_ANTIRUG_LIVE_EXECUTE`];
        // Strict 'true' match per D-LIVE-PER-CHAIN safety; any non-exact-'true'
        // string (including 'TRUE', '1', undefined) yields false → dry-run.
        const antiRugLiveExecute = antiRugLiveExecuteRaw === 'true';

        const antiRugLpRemovalPctRaw =
            process.env[`${template.envPrefix}_ANTIRUG_LP_REMOVAL_PCT`] ??
            String(template.defaultAntiRugLpRemovalPct);
        const antiRugLpRemovalPct = Number(antiRugLpRemovalPctRaw);
        if (
            Number.isNaN(antiRugLpRemovalPct) ||
            antiRugLpRemovalPct < 0 ||
            antiRugLpRemovalPct > 100
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_LP_REMOVAL_PCT`,
                    value: antiRugLpRemovalPctRaw,
                },
                'Anti-rug LP-removal-pct must be a number in [0, 100]'
            );
            process.exit(1);
        }

        const antiRugConfirmBlocksRaw =
            process.env[`${template.envPrefix}_ANTIRUG_CONFIRM_BLOCKS`] ??
            String(template.defaultAntiRugConfirmBlocks);
        const antiRugConfirmBlocks = Number(antiRugConfirmBlocksRaw);
        if (
            Number.isNaN(antiRugConfirmBlocks) ||
            !Number.isInteger(antiRugConfirmBlocks) ||
            antiRugConfirmBlocks < 0
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_CONFIRM_BLOCKS`,
                    value: antiRugConfirmBlocksRaw,
                },
                'Anti-rug confirm-blocks must be a non-negative integer'
            );
            process.exit(1);
        }

        const antiRugCBTriggersRaw =
            process.env[`${template.envPrefix}_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`] ??
            String(template.defaultAntiRugCircuitBreakerTriggers);
        const antiRugCBTriggers = Number(antiRugCBTriggersRaw);
        if (
            Number.isNaN(antiRugCBTriggers) ||
            !Number.isInteger(antiRugCBTriggers) ||
            antiRugCBTriggers < 1
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`,
                    value: antiRugCBTriggersRaw,
                },
                'Anti-rug circuit-breaker triggers must be an integer >= 1'
            );
            process.exit(1);
        }

        const antiRugCBWindowHoursRaw =
            process.env[`${template.envPrefix}_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS`] ??
            String(template.defaultAntiRugCircuitBreakerWindowHours);
        const antiRugCBWindowHours = Number(antiRugCBWindowHoursRaw);
        if (
            Number.isNaN(antiRugCBWindowHours) ||
            !Number.isInteger(antiRugCBWindowHours) ||
            antiRugCBWindowHours < 1
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS`,
                    value: antiRugCBWindowHoursRaw,
                },
                'Anti-rug circuit-breaker window-hours must be an integer >= 1'
            );
            process.exit(1);
        }

        const antiRugGasMultiplierRaw =
            process.env[`${template.envPrefix}_ANTIRUG_GAS_MULTIPLIER`] ??
            String(template.defaultAntiRugGasMultiplier);
        const antiRugGasMultiplier = Number(antiRugGasMultiplierRaw);
        if (
            Number.isNaN(antiRugGasMultiplier) ||
            antiRugGasMultiplier < 1.0
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_GAS_MULTIPLIER`,
                    value: antiRugGasMultiplierRaw,
                },
                'Anti-rug gas multiplier must be a number >= 1.0 (sub-1 is backward)'
            );
            process.exit(1);
        }

        const antiRugBackfillCapBlocksRaw =
            process.env[`${template.envPrefix}_ANTIRUG_BACKFILL_CAP_BLOCKS`] ??
            String(template.defaultAntiRugBackfillCapBlocks);
        const antiRugBackfillCapBlocks = Number(antiRugBackfillCapBlocksRaw);
        if (
            Number.isNaN(antiRugBackfillCapBlocks) ||
            !Number.isInteger(antiRugBackfillCapBlocks) ||
            antiRugBackfillCapBlocks < 1 ||
            antiRugBackfillCapBlocks > 100_000
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_BACKFILL_CAP_BLOCKS`,
                    value: antiRugBackfillCapBlocksRaw,
                },
                'Anti-rug backfill-cap-blocks must be an integer in [1, 100000]'
            );
            process.exit(1);
        }

        const antiRugMaxBackfillBlocksRaw =
            process.env[`${template.envPrefix}_ANTIRUG_MAX_BACKFILL_BLOCKS`] ??
            String(template.defaultAntiRugMaxBackfillBlocks);
        const antiRugMaxBackfillBlocks = Number(antiRugMaxBackfillBlocksRaw);
        if (
            Number.isNaN(antiRugMaxBackfillBlocks) ||
            !Number.isInteger(antiRugMaxBackfillBlocks) ||
            antiRugMaxBackfillBlocks < antiRugBackfillCapBlocks
        ) {
            log.fatal(
                {
                    chain: chainName,
                    key: `${template.envPrefix}_ANTIRUG_MAX_BACKFILL_BLOCKS`,
                    value: antiRugMaxBackfillBlocksRaw,
                    backfillCapBlocks: antiRugBackfillCapBlocks,
                },
                'Anti-rug max-backfill-blocks must be an integer >= backfill-cap-blocks'
            );
            process.exit(1);
        }

        // Operator allowlist overlay: comma-separated checksummed addresses.
        // Each entry validated via ethers.getAddress (FATAL on invalid checksum
        // per T-19-02-02 mitigation). Merged into BOTH allowlistV2 and
        // allowlistV3 per D-LIST-SOURCE (single overlay covers both pool types).
        const antiRugAllowlistExtraRaw =
            process.env[`${template.envPrefix}_ANTIRUG_ALLOWLIST_EXTRA`] ?? '';
        const antiRugAllowlistExtra: AllowlistEntry[] = [];
        if (antiRugAllowlistExtraRaw.trim().length > 0) {
            const tokens = antiRugAllowlistExtraRaw
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            for (const tok of tokens) {
                try {
                    const checksummed = ethers.getAddress(tok);
                    antiRugAllowlistExtra.push({
                        address: checksummed,
                        lockerName: 'Operator overlay',
                        provenance: 'env-overlay',
                    });
                } catch (err) {
                    log.fatal(
                        {
                            chain: chainName,
                            key: `${template.envPrefix}_ANTIRUG_ALLOWLIST_EXTRA`,
                            badAddress: tok,
                            err: (err as Error).message,
                        },
                        'Anti-rug allowlist-extra contains invalid address (checksum fail)'
                    );
                    process.exit(1);
                }
            }
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

            // Plan 18-CR-01 fix-along: an enabled chain using `on-chain-contract`
            // honeypot method MUST have a deployedAddress (either the literal in
            // CHAIN_TEMPLATES.{chain}.defaultHoneypotCheckerAddress, or the env
            // override <PREFIX>_HONEYPOT_CHECKER_ADDRESS). Without it, the
            // dispatcher returns verdict='unknown' (no-deployed-address) and the
            // bot.ts gate at src/bot.ts:233 / :460 hard-blocks every snipe on
            // this chain because verdict !== 'safe'. This is technically
            // fail-closed (correct) but is silently misleading — the operator
            // sees "Honeypot gate blocked" alerts on every token and may not
            // realize the gate cannot run at all on this chain. Fail loud at
            // boot instead, so the operator knows to deploy the checker (plan
            // 18-08 for BSC/Base/Arb) or explicitly set the env override.
            if (template.honeypotMethod === 'on-chain-contract' && !honeypotCheckerAddress) {
                log.fatal(
                    { chain: chainName, envVar: `${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS` },
                    'HoneypotChecker not deployed for enabled chain — set env var or wait for plan 18-08 deploy'
                );
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
            antiRug: {
                liveExecute: antiRugLiveExecute,
                lpRemovalPct: antiRugLpRemovalPct,
                confirmBlocks: antiRugConfirmBlocks,
                circuitBreakerTriggers: antiRugCBTriggers,
                circuitBreakerWindowHours: antiRugCBWindowHours,
                gasMultiplier: antiRugGasMultiplier,
                backfillCapBlocks: antiRugBackfillCapBlocks,
                maxBackfillBlocks: antiRugMaxBackfillBlocks,
                allowlistV2: mergeAllowlist(
                    HARDCODED_V2_ALLOWLIST[chainName] ?? [],
                    antiRugAllowlistExtra
                ),
                allowlistV3: mergeAllowlist(
                    HARDCODED_V3_ALLOWLIST[chainName] ?? [],
                    antiRugAllowlistExtra
                ),
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
