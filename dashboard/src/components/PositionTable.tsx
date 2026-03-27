import { useState } from 'react';
import type { Position } from '../types/api';
import { ChainBadge } from './ChainBadge';
import { formatAddress, formatPnL, formatEth, formatDuration, pnlColor } from '../utils/formatters';

interface PositionTableProps {
  positions: Position[];
  onForceSell: (tradeId: number, token: string, chain: string) => void;
}

export function PositionTable({ positions, onForceSell }: PositionTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Sort by P&L by default (descending)
  const sorted = [...positions].sort((a, b) => {
    const aPnl = a.pnl ?? 0;
    const bPnl = b.pnl ?? 0;
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

  const toggleRow = (tradeId: number) => {
    setExpandedRow((prev) => (prev === tradeId ? null : tradeId));
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
            <th className="text-right text-xs text-text-muted px-4 py-3 font-normal">Time Held</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pos) => (
            <PositionRow
              key={pos.tradeId}
              position={pos}
              expanded={expandedRow === pos.tradeId}
              onToggle={() => toggleRow(pos.tradeId)}
              onForceSell={() => onForceSell(pos.tradeId, pos.token, pos.chain)}
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
  exitMode: string;
  timeHeld: string;
}

function PositionRow({ position, expanded, onToggle, onForceSell, exitMode, timeHeld }: PositionRowProps) {
  const pos = position;

  return (
    <>
      <tr
        className="border-b border-border hover:bg-surface-lighter cursor-pointer min-h-[44px] transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-sm font-mono">{formatAddress(pos.token)}</td>
        <td className="px-4 py-3"><ChainBadge chain={pos.chain} /></td>
        <td className="px-4 py-3 text-sm text-right font-mono">{formatEth(pos.entryPrice)}</td>
        <td className="px-4 py-3 text-sm text-right font-mono">{formatEth(pos.currentPrice)}</td>
        <td className={`px-4 py-3 text-sm text-right font-mono ${pnlColor(pos.pnl)}`}>
          {formatPnL(pos.pnl)}
        </td>
        <td className="px-4 py-3 text-sm">{exitMode}</td>
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
          <td colSpan={8} className="bg-surface px-6 py-4 border-b border-border">
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
