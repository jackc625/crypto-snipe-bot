// test/fixtures/chainConfig.ts
// Mock chain configurations for Phase 4 tests.
// These inline types mirror the planned ChainConfig from src/chainRegistry.ts
// (which will be created in Plan 04-01). Once Plan 04-01 executes, tests
// can switch to importing from src/chainRegistry.ts.

export interface MockDexConfig {
  name: string;
  factoryAddress: string;
  routerAddress: string;
}

export interface MockSafetyApiConfig {
  honeypot: 'honeypot.is' | 'goplus';
  liquidityLock: 'unicrypt' | 'mudra' | 'goplus';
  tokenSecurity: 'goplus';
}

export type MockMevStrategyType = 'flashbots' | 'bloxroute' | 'passthrough';

export interface MockGasConfig {
  type: 'eip1559' | 'legacy';
  multiplier: number;
  maxGasLimit: bigint;
}

export interface MockChainConfig {
  chainId: number;
  name: string;
  displayName: string;
  enabled: boolean;
  nativeCurrency: string;
  wethAddress: string;
  httpRpcUrl: string;
  wsRpcUrl: string | null;
  dexes: MockDexConfig[];
  mevStrategy: MockMevStrategyType;
  mevConfig: Record<string, string>;
  safetyApis: MockSafetyApiConfig;
  gas: MockGasConfig;
  snipeAmount: string;
  maxCapital: string;
  explorerUrl: string;
}

export const mockEthConfig: MockChainConfig = {
  chainId: 1,
  name: 'eth',
  displayName: '[ETH]',
  enabled: true,
  nativeCurrency: 'ETH',
  wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  httpRpcUrl: 'http://localhost:8545',
  wsRpcUrl: 'ws://localhost:8546',
  dexes: [
    { name: 'uniswap-v2', factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    { name: 'sushiswap-v2', factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F' },
  ],
  mevStrategy: 'flashbots',
  mevConfig: { relayUrl: 'https://relay.flashbots.net', network: 'mainnet' },
  safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
  gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
  snipeAmount: '0.01',
  maxCapital: '1.0',
  explorerUrl: 'https://etherscan.io',
};

export const mockBscConfig: MockChainConfig = {
  chainId: 56,
  name: 'bsc',
  displayName: '[BSC]',
  enabled: true,
  nativeCurrency: 'BNB',
  wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  httpRpcUrl: 'http://localhost:8545',
  wsRpcUrl: 'ws://localhost:8546',
  dexes: [
    { name: 'pancakeswap-v2', factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    { name: 'biswap-v2', factoryAddress: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE', routerAddress: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8' },
  ],
  mevStrategy: 'bloxroute',
  mevConfig: { endpoint: 'https://api.blxrbdn.com' },
  safetyApis: { honeypot: 'goplus', liquidityLock: 'mudra', tokenSecurity: 'goplus' },
  gas: { type: 'legacy', multiplier: 1.1, maxGasLimit: 500_000n },
  snipeAmount: '0.05',
  maxCapital: '5.0',
  explorerUrl: 'https://bscscan.com',
};

export const mockBaseConfig: MockChainConfig = {
  chainId: 8453,
  name: 'base',
  displayName: '[BASE]',
  enabled: true,
  nativeCurrency: 'ETH',
  wethAddress: '0x4200000000000000000000000000000000000006',
  httpRpcUrl: 'http://localhost:8545',
  wsRpcUrl: null,
  dexes: [
    { name: 'uniswap-v2-base', factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    { name: 'aerodrome', factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' },
  ],
  mevStrategy: 'passthrough',
  mevConfig: {},
  safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'goplus', tokenSecurity: 'goplus' },
  gas: { type: 'eip1559', multiplier: 1.1, maxGasLimit: 500_000n },
  snipeAmount: '0.005',
  maxCapital: '0.5',
  explorerUrl: 'https://basescan.org',
};

export const mockArbConfig: MockChainConfig = {
  chainId: 42161,
  name: 'arb',
  displayName: '[ARB]',
  enabled: true,
  nativeCurrency: 'ETH',
  wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  httpRpcUrl: 'http://localhost:8545',
  wsRpcUrl: null,
  dexes: [
    { name: 'uniswap-v2-arb', factoryAddress: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9', routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    { name: 'camelot-v2', factoryAddress: '0x6EcCab422D763aC031210895C81787E87B43A652', routerAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d' },
  ],
  mevStrategy: 'passthrough',
  mevConfig: {},
  safetyApis: { honeypot: 'goplus', liquidityLock: 'goplus', tokenSecurity: 'goplus' },
  gas: { type: 'eip1559', multiplier: 1.1, maxGasLimit: 1_000_000n },
  snipeAmount: '0.005',
  maxCapital: '0.5',
  explorerUrl: 'https://arbiscan.io',
};

// All 4 configs in an array for iteration
export const allMockConfigs = [mockEthConfig, mockBscConfig, mockBaseConfig, mockArbConfig];
