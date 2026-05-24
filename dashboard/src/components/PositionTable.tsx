import { useState } from 'react';
import type { Position } from '../types/api';
import { ChainBadge } from './ChainBadge';
import { AntiRugStateBadge } from './anti-rug/AntiRugStateBadge';
import { formatAddress, formatPnL, formatEth, formatDuration, pnlColor } from '../utils/formatters';

interface PositionTableProps {
  positions: Position[];
  onForceSell: (tradeId: number, token: string, chain: string) => void;
  /** Phase 19 / Plan 19-06 — opens the AntiRugExitDetailModal for the given trade. */
  onAntiRugBadgeClick?: (tradeId: number, token: string, chain: string) => void;
}

export function PositionTable({ positions, onForceSell, onAntiRugBadgeClick }: PositionTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Sort by unrealized P&L by default (descending), fall back to realized pnl
  const sorted = [...positions].sort((a, b) => {
    const aPnl = a.unrealizedPnl ?? a.pnl ?? 0;
    const bPnl = b.unrealizedPnl ?? b.pnl ?? 0;
    return bPnl - aPnl;
  });

  if (sorted.length === 0) {
    return (
      <div className="bg-surface-light border border-border rounded-lg p-8 text-center">
        <h3 className="text-xl font-bold mb-2">No Open Positions</h3>
        <p className="text-sm text-text-muted">
          The bot is running but has not entered any positions yet. New snipes will appear here in real time.
        </p>
      </div>
    );
  }

  const rowKey = (pos: Position) => `${pos.token}-${pos.chain}`;

  const toggleRow = (key: string) => {
    setExpandedRow((prev) => (prev === key ? null : key));
  };

  const getExitMode = (pos: Position): string => {
    if (!pos.exitState) return '--';
    if (pos.exitState.urgencyPct > 0) return 'Urgency';
    if (pos.exitState.trailingActivated) return 'Trailing';
    return 'Fixed SL';
  };

  const getTimeHeld = (pos: Position): string => {
    const elapsed = Math.floor(Date.now() / 1000) - pos.buyTime;
    return formatDuration(elapsed);
  };

  return (
    <div className="bg-surface-light border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs text-text-muted px-4 py-3 font-normal">Token</th>
            <th className="text-left text-xs text-text-muted px-4 py-3 font-normal">Chain</th>
            <th className="text-right text-xs text-text-muted px-4 py-3 font-normal">Entry</th>
            <th className="text-right text-xs text-text-muted px-4 py-3 font-normal">Current</th>
            <th className="text-right text-xs text-text-muted px-4 py-3 font-normal">P&L</th>
            <th className="text-left text-xs text-text-muted px-4 py-3 font-normal">Exit Mode</th>
            <th className="text-left text-xs text-text-muted px-4 py-3 font-normal">Anti-Rug</th>
            <th className="text-right text-xs text-text-muted px-4 py-3 font-normal">Time Held</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pos) => (
            <PositionRow
              key={rowKey(pos)}
              position={pos}
              expanded={expandedRow === rowKey(pos)}
              onToggle={() => toggleRow(rowKey(pos))}
              onForceSell={() => onForceSell(pos.tradeId, pos.token, pos.chain)}
              onAntiRugBadgeClick={
                onAntiRugBadgeClick
                  ? () => onAntiRugBadgeClick(pos.tradeId, pos.token, pos.chain)
                  : undefined
              }
              exitMode={getExitMode(pos)}
              timeHeld={getTimeHeld(pos)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PositionRowProps {
  position: Position;
  expanded: boolean;
  onToggle: () => void;
  onForceSell: () => void;
  onAntiRugBadgeClick?: () => void;
  exitMode: string;
  timeHeld: string;
}

const antiRugTooltips: Record<string, (chain: string) => string> = {
  'live': (chain) =>
    `Anti-rug monitor is live on ${chain.toUpperCase()}. A confirmed rug signal will trigger an exit through executeFullSell.`,
  'dry-run': (chain) =>
    `Anti-rug monitor is in dry-run on ${chain.toUpperCase()}. Detections are logged but no exit is fired.`,
  'would-have-sold': () =>
    `Dry-run detected a confirmed rug signal. Click for evidence.`,
  'exit-fired': () =>
    `Anti-rug exit fired. Click for tx artifacts.`,
  'halted': (chain) =>
    `Circuit breaker tripped on ${chain.toUpperCase()}. Anti-rug monitoring is paused until manual reset.`,
  'unmonitored': () =>
    `No LP baseline recorded for this position. Anti-rug monitoring is not active.`,
};

/**
 * CR-06-FOLLOWUP (iter-2): override the base 'exit-fired' tooltip when
 * the wire payload's `success` boolean is present, so the operator can
 * differentiate `exit-fired-success` from `exit-fired-failure` from the
 * positions table hover-tip alone — without needing to click into the
 * detail modal. `success === undefined` falls through to the base
 * tooltip from `antiRugTooltips` above (covers the pre-iter-2 wire and
 * the would-have-sold path, where success is not applicable).
 */
function antiRugTooltipFor(state: string, chain: string, success?: boolean): string {
  if (state === 'exit-fired') {
    if (success === true) {
      return `Anti-rug exit SUCCEEDED on ${chain.toUpperCase()}. executeFullSell returned true. Click for tx artifacts.`;
    }
    if (success === false) {
      return `Anti-rug exit FAILED on ${chain.toUpperCase()}. executeFullSell returned false — the position is still open and a trigger slot was consumed. Click for tx artifacts.`;
    }
  }
  const fn = antiRugTooltips[state] ?? antiRugTooltips['unmonitored'];
  return fn(chain);
}

function PositionRow({
  position,
  expanded,
  onToggle,
  onForceSell,
  onAntiRugBadgeClick,
  exitMode,
  timeHeld,
}: PositionRowProps) {
  const pos = position;
  const arState = pos.antiRugState ?? 'unmonitored';
  // CR-06-FOLLOWUP (iter-2): pass `success` into the tooltip helper so
  // exit-fired hovers reflect the live-execute outcome.
  const arTooltip = antiRugTooltipFor(arState, pos.chain, pos.antiRugLastSuccess);

  return (
    <>
      <tr
        className="border-b border-border hover:bg-surface-lighter cursor-pointer min-h-[44px] transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-sm font-mono">{formatAddress(pos.token)}</td>
        <td className="px-4 py-3"><ChainBadge chain={pos.chain} /></td>
        <td className="px-4 py-3 text-sm text-right font-mono">{formatEth(pos.entryPrice)}</td>
        <td
          className={`px-4 py-3 text-sm text-right font-mono ${pos.priceStale ? 'text-warning' : ''}`}
          title={pos.priceStale ? 'Live price unavailable. Showing last known value.' : undefined}
        >
          {formatEth(pos.currentPrice)}
          {pos.priceStale && (
            <span className="text-xs text-text-muted ml-1">(stale)</span>
          )}
        </td>
        <td className={`px-4 py-3 text-sm text-right font-mono ${pnlColor(pos.unrealizedPnl ?? pos.pnl)}`}>
          {formatPnL(pos.unrealizedPnl ?? pos.pnl)}
        </td>
        <td className="px-4 py-3 text-sm">{exitMode}</td>
        <td className="px-4 py-3">
          <AntiRugStateBadge
            state={pos.antiRugState ?? 'unmonitored'}
            chain={pos.chain}
            onClick={onAntiRugBadgeClick}
            title={arTooltip}
            success={pos.antiRugLastSuccess}
          />
        </td>
        <td className="px-4 py-3 text-sm text-right text-text-muted">{timeHeld}</td>
        <td className="px-2 py-3 text-text-muted">
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>

      {/* Expanded detail section -- accordion pattern, only one row at a time */}
      {expanded && (
        <tr className="cursor-pointer" onClick={onToggle}>
          <td colSpan={9} className="bg-surface px-6 py-4 border-b border-border">
            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"
              style={{ animation: 'slideDown 150ms ease-out' }}
            >
              <div>
                <p className="text-xs text-text-muted">High-Water Mark</p>
                <p className="font-mono mt-0.5">
                  {pos.exitState ? formatEth(pos.exitState.highWaterMark) : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Partial Sells</p>
                <p className="font-mono mt-0.5">
                  {pos.exitState
                    ? `${pos.exitState.partialTiersCompleted.length} tiers completed`
                    : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Volatility</p>
                <p className="font-mono mt-0.5">
                  {pos.exitState && pos.exitState.volatilitySamples.length > 0
                    ? pos.exitState.volatilitySamples[pos.exitState.volatilitySamples.length - 1].toFixed(4)
                    : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Urgency</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 h-2 bg-surface-lighter rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        (pos.exitState?.urgencyPct ?? 0) > 90
                          ? 'bg-loss'
                          : (pos.exitState?.urgencyPct ?? 0) > 70
                          ? 'bg-warning'
                          : 'bg-accent'
                      }`}
                      style={{ width: `${pos.exitState?.urgencyPct ?? 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs">
                    {pos.exitState ? `${pos.exitState.urgencyPct.toFixed(0)}%` : '--'}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-text-muted">Buy Cost</p>
                <p className="font-mono mt-0.5">{formatEth(pos.buyCost)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Gas Cost</p>
                <p className="font-mono mt-0.5">{formatEth(pos.buyGas)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Pool Type</p>
                <p className="mt-0.5">{pos.poolType.toUpperCase()}{pos.feeTier ? ` (${pos.feeTier / 10000}%)` : ''}</p>
              </div>
              <div className="flex items-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onForceSell();
                  }}
                  className="bg-loss text-white px-4 py-2 rounded text-sm hover:opacity-90 transition-colors"
                >
                  Force Sell
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
