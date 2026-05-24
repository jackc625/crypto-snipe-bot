// TypeScript interfaces for API responses

// ---------------------------------------------------------------------------
// Phase 19 / Plan 19-06 — Anti-Rug runtime monitoring types
// ---------------------------------------------------------------------------

/**
 * UI-SPEC §"Anti-Rug column header and badges" — 6 semantic badge states for
 * the Anti-Rug positions-table column. Mirrors the backend
 * `AntiRugMonitorState` union in src/anti-rug/types.ts; declared locally so
 * the dashboard tsconfig (separate ts root) is self-contained.
 */
export type AntiRugMonitorState =
  | 'live'
  | 'dry-run'
  | 'would-have-sold'
  | 'exit-fired'
  | 'halted'
  | 'unmonitored';

/**
 * Per-signal evidence payload from the multi-signal AND-chain evaluator.
 * Matches the backend `RugSignals` interface in src/anti-rug/types.ts.
 */
export interface RugSignals {
  lpRemovedPct: number;
  destination: string;
  allowlistHit: 'safe' | 'unsafe' | 'unknown';
  sellSimSlippagePct: number | null;
  v2ReservePctBelow: number | null;
}

/**
 * Single trigger event payload. Backend `TriggerEvent` mirror — consumed by
 * the CB-reset modal + Anti-Rug Monitor tile.
 */
export interface TriggerEvent {
  token: string;
  pair: string;
  signals: RugSignals;
  outcome: string;
  timestamp: number;
  chain: string;
}

/**
 * WS event payload for `antirug_event` per UI-SPEC §"Realtime Push Contract".
 * Discriminated by `kind`:
 *   - 'trigger'              — confirmed rug signal evaluated (dry-run or live)
 *   - 'allowlist-suppression' — destination matched a known locker; no trigger
 *   - 'gap-detected'         — backfill window exceeded maxBackfillBlocks
 *
 * WR-09: `pair` is OPTIONAL because the 'gap-detected' kind is a
 * chain-level event with no pair anchor. Consumers that destructure
 * `pair` must guard for undefined (use `pair ?? ''` or branch on
 * `kind`). Previously declared required, which silently mismatched the
 * backend's gap-detected broadcast that omitted the field.
 */
export interface AntiRugEvent {
  chain: string;
  kind: 'trigger' | 'allowlist-suppression' | 'gap-detected';
  token?: string;
  pair?: string;
  signals?: RugSignals;
  outcome?: 'live-exit' | 'dry-run-would-have-sold' | 'too-late' | 'would-have-saved-X-ETH';
  timestamp: number;
  lockerName?: string;
  gapBlocks?: number;
  fromBlock?: number;
  toBlock?: number;
}

/**
 * WS event payload for `chain_ws_health_change` per UI-SPEC §"Realtime Push
 * Contract". Drives the per-chain 🟢/🟡/🔴 indicator + sidebar dot.
 */
export interface ChainWsHealthChange {
  chain: string;
  state: 'connected' | 'reconnecting' | 'disconnected';
  lastPongTs?: number;
  disconnectedDurationSec?: number;
}

/**
 * WS event payload for `cb_tripped` per UI-SPEC §"Realtime Push Contract".
 * Pre-populates the CircuitBreakerResetModal triggers list per Warning 11.
 */
export interface CbTrippedPayload {
  chain: string;
  triggers: TriggerEvent[];
  windowHours: number;
  triggerCount: number;
}

/**
 * WS event payload for `cb_reset` per UI-SPEC §"Realtime Push Contract".
 */
export interface CbResetPayload {
  chain: string;
  resetByOperatorTs: number;
}

/**
 * WS event payload for `antirug_state_update` per UI-SPEC §"Realtime Push
 * Contract". Merges into the Position row matching `tradeId`.
 *
 * CR-06: `success` is set on the exit-fired path (live execute) to surface
 * whether executeFullSell returned true/false to the operator. `null` is
 * permitted on `lastSignals` because the 'unknown'-verdict variant of
 * RugEvaluation does not carry signals; consumers must treat both `null`
 * and `undefined` as 'no signals available' (do not use `typeof
 * x === 'object'` truthy checks because `null` is a truthy object).
 */
export interface AntiRugStateUpdate {
  tradeId: number;
  chain: string;
  state: AntiRugMonitorState;
  lastEventTs?: number;
  lastSignals?: RugSignals | null;
  success?: boolean;
}

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
  // Phase 19 / Plan 19-06 — anti-rug per-position state
  antiRugState?: AntiRugMonitorState;
  antiRugLastEventTs?: number;
  antiRugLastSignals?: RugSignals;
  /**
   * CR-06-FOLLOWUP (iter-2): mirrored from `AntiRugStateUpdate.success`
   * over the wire. Only meaningful when `antiRugState === 'exit-fired'`:
   *   - `true`  : executeFullSell returned true (live exit confirmed)
   *   - `false` : executeFullSell returned false (live exit failed —
   *               position still open, trigger slot consumed, CB one
   *               step closer to tripping)
   *   - undefined: state is not 'exit-fired' (e.g., 'would-have-sold'
   *                dry-run path, where success is not applicable).
   * Drives the green-check vs red-X overlay on AntiRugStateBadge and
   * the success/failure banner inside AntiRugExitDetailModal.
   */
  antiRugLastSuccess?: boolean;
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
