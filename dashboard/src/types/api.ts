// TypeScript interfaces for API responses

export interface ExitStateInfo {
  highWaterMark: number;
  trailingActivated: boolean;
  partialTiersCompleted: number[];
  urgencyStartTs: number;
  urgencyPct: number;
  originalTokenAmount: string;
  volatilitySamples: number[];
}

export interface Position {
  tradeId: number;
  token: string;
  chain: string;
  entryPrice: number | null;
  currentPrice: number | null;
  pnl: number | null;
  buyCost: string | null;
  buyGas: string | null;
  buyTime: number;
  poolType: string;
  feeTier: number | null;
  exitState: ExitStateInfo | null;
}

export interface Trade {
  id: number;
  token: string;
  chain: string;
  action: 'buy' | 'sell';
  amount: string | null;
  price: number | null;
  gasUsed: string | null;
  txHash: string | null;
  buyTime: number | null;
  sellTime: number | null;
  durationHeld: number | null;
  realizedPnl: number | null;
  exitReason: string | null;
  peakPrice: number | null;
  poolType: string;
  feeTier: number | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ChainStatus {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'disconnected';
  config: {
    snipeAmount: string;
    maxCapital: string;
    rpcUrl: string;
    chainId: number;
    wsConnected: boolean;
    latestBlock: number | null;
    dexes: string[];
  };
}

export interface RiskExposure {
  total: number;
  byChain: Record<string, number>;
}

export interface RiskLimits {
  positionLimit: { used: number; max: number };
  exposureLimit: { used: number; max: number };
  dailyLoss: { used: number; limitPct: number };
}

export interface PnLDataPoint {
  time: number;
  value: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  chains: Array<{
    name: string;
    displayName: string;
    connected: boolean;
    latestBlock: number | null;
    wsConnected: boolean;
  }>;
  positions: {
    open: number;
    totalExposure: number;
    dailyPnL: number;
  };
  version: string;
}

export interface WsEvent<T> {
  type: string;
  data: T;
  timestamp: number;
}

export interface NotificationEvent {
  severity: 'success' | 'warning' | 'error' | 'info';
  message: string;
  chain?: string;
  category: string;
  timestamp: number;
}
