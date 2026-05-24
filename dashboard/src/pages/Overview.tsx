import { useState, useMemo } from 'react';
import { useWs } from '../hooks/WebSocketContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/StatCard';
import { PositionTable } from '../components/PositionTable';
import { EventFeed } from '../components/EventFeed';
import { ConfirmDialog } from '../components/ConfirmDialog';
// Phase 19 / Plan 19-06 — Anti-rug dashboard surfaces
import { CircuitBreakerBanner } from '../components/anti-rug/CircuitBreakerBanner';
import { CircuitBreakerResetModal } from '../components/anti-rug/CircuitBreakerResetModal';
import { AntiRugMonitorTile } from '../components/anti-rug/AntiRugMonitorTile';
import { AntiRugExitDetailModal } from '../components/anti-rug/AntiRugExitDetailModal';
import { FrontrunDistributionPanel } from '../components/anti-rug/FrontrunDistributionPanel';
import { GapDetectedBanner } from '../components/anti-rug/GapDetectedBanner';
import type { RiskExposure, RiskLimits, HealthResponse, AntiRugEvent } from '../types/api';
import { formatPnL } from '../utils/formatters';

export function Overview() {
  const { positions, notifications, antiRugEvents, circuitBreakerTrips } = useWs();
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

  // Phase 19 / Plan 19-06 — Modal-open state lifted to Overview (single source
  // of truth across PositionTable click + AntiRugMonitorTile row click triggers).
  const [resetModalTarget, setResetModalTarget] = useState<string | null>(null);
  const [antiRugDetailTarget, setAntiRugDetailTarget] = useState<{
    tradeId: number;
    token: string;
    chain: string;
  } | null>(null);

  // Determine the active chain — for the Anti-Rug Monitor + Frontrun panel.
  // For v6.17 ETH is the only enabled chain; fall back gracefully.
  const activeChain = useMemo(() => {
    const chainSet = new Set<string>();
    positions.forEach((p) => chainSet.add(p.chain));
    Object.keys(antiRugEvents).forEach((c) => chainSet.add(c));
    return Array.from(chainSet)[0] ?? 'eth';
  }, [positions, antiRugEvents]);

  // Per-chain most-recent gap-detected event (drives GapDetectedBanner).
  const gapEventByChain = useMemo(() => {
    const out: Record<string, AntiRugEvent | null> = {};
    for (const [chain, events] of Object.entries(antiRugEvents)) {
      const gap = events.find((e) => e.kind === 'gap-detected');
      out[chain] = gap ?? null;
    }
    return out;
  }, [antiRugEvents]);

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

  // Triggers for the CB-reset modal — pulled from circuitBreakerTrips for the
  // currently-targeted chain.
  const resetModalTriggers = resetModalTarget
    ? circuitBreakerTrips[resetModalTarget]?.triggers ?? []
    : [];
  const resetModalWindowHours = resetModalTarget
    ? circuitBreakerTrips[resetModalTarget]?.windowHours ?? 1
    : 1;

  // Build detail modal props — for v6.17 the modal renders signals from the
  // position's antiRugLastSignals (the future fork test fleshes out tx
  // artifacts). Variant inferred from the position's antiRugState.
  const detailPosition = antiRugDetailTarget
    ? positions.find((p) => p.tradeId === antiRugDetailTarget.tradeId)
    : null;
  const detailVariant: 'live' | 'dry-run' | 'pending-confirm' =
    detailPosition?.antiRugState === 'exit-fired'
      ? 'live'
      : detailPosition?.antiRugState === 'would-have-sold'
      ? 'dry-run'
      : 'pending-confirm';

  return (
    <div className="space-y-8">
      {/* Phase 19 — CB-tripped banner (sticky at top when any chain tripped) */}
      <CircuitBreakerBanner
        trips={circuitBreakerTrips}
        onResetClick={(chain) => setResetModalTarget(chain)}
      />

      {/* Phase 19 — Per-chain gap-detected banners */}
      {Object.entries(gapEventByChain).map(([chain, evt]) => (
        <GapDetectedBanner key={chain} chain={chain} event={evt} />
      ))}

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
        onAntiRugBadgeClick={(tradeId, token, chain) =>
          setAntiRugDetailTarget({ tradeId, token, chain })
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

      {/* Phase 19 — Anti-Rug Monitor tile + Frontrun distribution panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AntiRugMonitorTile
          chain={activeChain}
          events={antiRugEvents[activeChain] ?? []}
          onEventClick={(evt) => {
            // Find the matching position by pair (best-effort — fallback opens modal with empty target)
            const matchPos = positions.find(
              (p) => p.chain === evt.chain && p.token.toLowerCase() === (evt.token ?? '').toLowerCase(),
            );
            if (matchPos) {
              setAntiRugDetailTarget({
                tradeId: matchPos.tradeId,
                token: matchPos.token,
                chain: matchPos.chain,
              });
            }
          }}
        />
        <FrontrunDistributionPanel chain={activeChain} events={antiRugEvents[activeChain] ?? []} />
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

      {/* Phase 19 — CB-reset modal (opens when operator clicks a banner chip) */}
      <CircuitBreakerResetModal
        open={resetModalTarget !== null}
        chain={resetModalTarget ?? ''}
        triggers={resetModalTriggers}
        windowHours={resetModalWindowHours}
        onConfirmed={() => setResetModalTarget(null)}
        onDismiss={() => setResetModalTarget(null)}
      />

      {/* Phase 19 — Anti-Rug exit detail modal */}
      <AntiRugExitDetailModal
        open={antiRugDetailTarget !== null}
        variant={detailVariant}
        tokenSymbol={antiRugDetailTarget?.token ? antiRugDetailTarget.token.slice(0, 10) + '...' : ''}
        chain={antiRugDetailTarget?.chain ?? ''}
        signals={detailPosition?.antiRugLastSignals}
        onDismiss={() => setAntiRugDetailTarget(null)}
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
