import { useState, useMemo } from 'react';
import { useWs } from '../hooks/WebSocketContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/StatCard';
import { PositionTable } from '../components/PositionTable';
import { EventFeed } from '../components/EventFeed';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { RiskExposure, RiskLimits, HealthResponse } from '../types/api';
import { formatPnL } from '../utils/formatters';

export function Overview() {
  const { positions, notifications } = useWs();
  const { data: exposure } = useApi<RiskExposure>('/api/risk/exposure');
  const { data: limits } = useApi<RiskLimits>('/api/risk/limits');
  const { data: health } = useApi<HealthResponse>('/health');

  // Force sell state
  const [forceSellTarget, setForceSellTarget] = useState<{
    tradeId: number;
    token: string;
    chain: string;
  } | null>(null);
  const [forceSellError, setForceSellError] = useState<string | null>(null);

  // Calculate stat card values from positions data
  const stats = useMemo(() => {
    const totalPnL = positions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
    const openCount = positions.length;
    const totalExposure = exposure?.total ?? 0;
    const dailyPnL = health?.positions?.dailyPnL ?? 0;

    return {
      totalPnL: formatPnL(totalPnL),
      openPositions: String(openCount),
      totalExposure: totalExposure.toFixed(4),
      dailyPnL: formatPnL(dailyPnL),
    };
  }, [positions, exposure, health]);

  const handleForceSell = async () => {
    if (!forceSellTarget) return;
    setForceSellError(null);

    try {
      const response = await fetch(`/api/controls/force-sell/${forceSellTarget.tradeId}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
        setForceSellError(
          `Force sell failed: ${errData.error || 'Unknown error'}. The position may still be open. Check the bot logs.`
        );
        return;
      }

      setForceSellTarget(null);
    } catch {
      setForceSellError(
        'Force sell failed: Network error. The position may still be open. Check the bot logs.'
      );
    }
  };

  // Risk gauge helper
  const gaugeColor = (pct: number): string => {
    if (pct >= 90) return 'bg-loss';
    if (pct >= 70) return 'bg-warning';
    return 'bg-accent';
  };

  const positionPct = limits
    ? Math.min((limits.positionLimit.used / limits.positionLimit.max) * 100, 100)
    : 0;
  const dailyLossPct = limits
    ? Math.min((limits.dailyLoss.used / (limits.dailyLoss.limitPct || 100)) * 100, 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Page title */}
      <h1 className="text-xl font-bold">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total P&L" value={stats.totalPnL} />
        <StatCard label="Open Positions" value={stats.openPositions} />
        <StatCard label="Total Exposure" value={stats.totalExposure} />
        <StatCard label="24h P&L" value={stats.dailyPnL} />
      </div>

      {/* Positions table */}
      <PositionTable
        positions={positions}
        onForceSell={(tradeId, token, chain) =>
          setForceSellTarget({ tradeId, token, chain })
        }
      />

      {/* Risk gauges + Event feed side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk gauges */}
        <div className="bg-surface-light border border-border rounded-lg p-4">
          <h3 className="text-xl font-bold mb-4">Risk Limits</h3>

          {/* Position Limit gauge */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-text-muted mb-1">
              <span>Position Limit</span>
              <span>
                {limits ? `${limits.positionLimit.used} / ${limits.positionLimit.max}` : '-- / --'}
              </span>
            </div>
            <div className="h-3 bg-surface-lighter rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${gaugeColor(positionPct)}`}
                style={{ width: `${positionPct}%` }}
              />
            </div>
          </div>

          {/* Daily Loss Limit gauge */}
          <div>
            <div className="flex justify-between text-xs text-text-muted mb-1">
              <span>Daily Loss Limit</span>
              <span>
                {limits
                  ? `${limits.dailyLoss.used.toFixed(2)}% / ${limits.dailyLoss.limitPct}%`
                  : '-- / --'}
              </span>
            </div>
            <div className="h-3 bg-surface-lighter rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${gaugeColor(dailyLossPct)}`}
                style={{ width: `${dailyLossPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Event feed (spans 2 columns on large screens) */}
        <div className="lg:col-span-2">
          <EventFeed events={notifications} />
        </div>
      </div>

      {/* Force sell confirmation dialog */}
      <ConfirmDialog
        open={forceSellTarget !== null}
        title={`Force Sell ${forceSellTarget?.token ? forceSellTarget.token.slice(0, 10) + '...' : ''}?`}
        body={`This will immediately market sell your entire ${
          forceSellTarget?.token ? forceSellTarget.token.slice(0, 10) + '...' : 'token'
        } position on ${forceSellTarget?.chain?.toUpperCase() || 'unknown chain'}. This action cannot be undone.`}
        confirmLabel="Force Sell"
        dismissLabel="Keep Position"
        variant="destructive"
        onConfirm={handleForceSell}
        onDismiss={() => {
          setForceSellTarget(null);
          setForceSellError(null);
        }}
      />

      {/* Force sell error banner */}
      {forceSellError && (
        <div className="border-l-2 border-loss bg-surface-light rounded-r-lg px-4 py-3">
          <p className="text-sm text-loss">{forceSellError}</p>
        </div>
      )}
    </div>
  );
}
