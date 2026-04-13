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
  priceStale: boolean;              // D-03: true when live price unavailable, fell back to highWaterMark
  unrealizedPnl: number | null;     // D-05: live unrealized P&L with net cost basis
  pnl: number | null;
  buyCost: string | null;
  buyGas: string | null;
  buyTime: number;
  poolType: string;
  feeTier: number | null;
  sellRevenue: number;              // Aggregated sell revenue from partial sells
  exitState: ExitStateInfo | null;
}

export interface Trade {
  id: number;                      // buy_id from API (React key)
  token: string;
  chain: string;
  action: 'open' | 'closed';      // Derived from buy_status, not buy/sell action
  pnl: number | null;             // Realized P&L (was: realizedPnl)
  sellCount: number;              // D-02: count of sell + partial_sell events
  buyTime: number;                // Always present (was: number | null)
  sellTime: number | null;
  durationHeld: number | null;
  buyCost: string | null;         // Buy cost in ETH/BNB (was: amount)
  buyGas: string | null;          // Buy gas cost (was: gasUsed)
  sellRevenue: number;            // Aggregated sell revenue
  sellGas: number;                // Aggregated sell gas
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
  wsConnected: boolean;
  snipeParams: {
    snipeAmount: string;
    maxCapital: string;
    minLiquidity: string;
  };
  riskLimits: {
    maxOpenPositions: string;
    maxTotalExposure: string;
    dailyLossPct: string;
  };
  exitStrategy: {
    trailingStopPct: number;
    stopLossPct: number;
    partialSellTiers: Array<{ multiple: number; percent: number }>;
    urgencyWindowMs: number;
  };
  connection: {
    rpcUrl: string;
    wsUrl: string | null;
    chainId: number;
    lastBlock: number | null;
  };
  dexes: string[];
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
  telegramConnected: boolean;       // D-19: Telegram client connection status
  telegramError: string | null;     // D-19: Error message when disconnected
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
