// dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx
// Phase 19 / Plan 19-06 — Per-chain anti-rug stats + last-10-events tile.
//
// Surfaces:
//   - Dry-run events today  (stat number via StatCard pattern)
//   - Suppressed today      (stat number via StatCard pattern)
//   - Last 10 events        (scrollable list via EventFeed row layout)
//   - Empty state           (verbatim UI-SPEC body copy when no events)
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Anti-Rug Monitor tile" (verbatim copy + stat labels + row format)
//   - dashboard/src/components/StatCard.tsx — 28px stat-number pattern
//   - dashboard/src/components/EventFeed.tsx — last-N list pattern + severityColor
//   - dashboard/src/components/ChainBadge.tsx — per-chain badge primitive

import type { AntiRugEvent } from '../../types/api';
import { ChainBadge } from '../ChainBadge';
import { formatAddress, formatTimeAgo } from '../../utils/formatters';

interface AntiRugMonitorTileProps {
  chain: string;
  events: AntiRugEvent[];
  onEventClick?: (evt: AntiRugEvent) => void;
}

export function AntiRugMonitorTile({ chain, events, onEventClick }: AntiRugMonitorTileProps) {
  // Per-chain stats — events from today on this chain only.
  const startOfTodayMs = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const todays = events.filter((e) => e.chain === chain && e.timestamp >= startOfTodayMs);
  const dryRunCount = todays.filter(
    (e) => e.kind === 'trigger' && e.outcome === 'dry-run-would-have-sold',
  ).length;
  const suppressedCount = todays.filter((e) => e.kind === 'allowlist-suppression').length;
  const lastTen = events.filter((e) => e.chain === chain).slice(0, 10);

  return (
    <div className="bg-surface-light border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold leading-[1.2]">Anti-Rug Monitor</h3>
        <ChainBadge chain={chain} />
      </div>

      {/* Per-chain stat row — uses StatCard 28px pattern inline */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-surface rounded-lg p-3">
          <p className="text-xs text-text-muted leading-[1.4]">Dry-run events today</p>
          <p className="text-[28px] font-bold leading-[1.1] mt-1 text-text">{dryRunCount}</p>
        </div>
        <div className="bg-surface rounded-lg p-3">
          <p className="text-xs text-text-muted leading-[1.4]">Suppressed today</p>
          <p className="text-[28px] font-bold leading-[1.1] mt-1 text-text">{suppressedCount}</p>
        </div>
      </div>

      {/* Last 10 events */}
      <h4 className="text-xs text-text-muted font-bold mb-2">Last 10 events</h4>
      {lastTen.length === 0 ? (
        <div className="text-sm text-text-muted py-4">
          <p className="font-bold mb-1">No anti-rug events yet</p>
          <p>
            Anti-rug monitoring is active on {chain.toUpperCase()}. Confirmed rug signals and allowlist suppressions will appear here as the bot operates.
          </p>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {lastTen.map((evt, i) => (
            <button
              key={`${evt.timestamp}-${i}`}
              type="button"
              onClick={() => onEventClick?.(evt)}
              className={`w-full text-left flex items-start gap-3 px-3 py-2 rounded border-l-2 bg-surface/50 ${
                evt.kind === 'gap-detected'
                  ? 'border-warning'
                  : evt.kind === 'allowlist-suppression'
                  ? 'border-info'
                  : evt.outcome === 'live-exit'
                  ? 'border-loss'
                  : 'border-warning'
              }`}
            >
              <span className="text-xs text-text-muted whitespace-nowrap shrink-0">
                {formatTimeAgo(evt.timestamp)}
              </span>
              {/* WR-09: gap-detected events have no pair (chain-level event). */}
              <span className="text-sm text-text font-mono">
                {evt.kind === 'gap-detected' ? '—' : formatAddress(evt.pair ?? '')}
              </span>
              <span className="text-sm text-text-muted flex-1 truncate">
                {evt.kind === 'allowlist-suppression'
                  ? `Allowlist hit — ${evt.lockerName ?? 'unknown locker'}`
                  : evt.kind === 'gap-detected'
                  ? `Gap detected — ${evt.gapBlocks ?? 0} blocks missed`
                  : evt.signals
                  ? `LP −${evt.signals.lpRemovedPct}% • dest ${formatAddress(evt.signals.destination)} • ${evt.outcome ?? 'pending'}`
                  : (evt.outcome ?? 'pending')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
