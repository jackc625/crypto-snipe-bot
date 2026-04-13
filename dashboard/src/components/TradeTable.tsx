import { useState, useMemo } from 'react';
import type { Trade, Pagination } from '../types/api';
import { ChainBadge } from './ChainBadge';
import { formatPnL, formatEth, formatDuration, pnlColor, formatAddress } from '../utils/formatters';

interface TradeTableProps {
  trades: Trade[];
  pagination: Pagination;
  onPageChange: (page: number) => void;
}

type SortField = 'token' | 'chain' | 'pnl' | 'buyTime' | 'sellTime' | 'durationHeld' | 'buyCost' | 'poolType';
type SortDir = 'asc' | 'desc';

export function TradeTable({ trades, pagination, onPageChange }: TradeTableProps) {
  const [sortField, setSortField] = useState<SortField>('buyTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedTrades = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (sortField) {
        case 'token':
          aVal = a.token;
          bVal = b.token;
          break;
        case 'chain':
          aVal = a.chain;
          bVal = b.chain;
          break;
        case 'pnl':
          aVal = a.pnl;
          bVal = b.pnl;
          break;
        case 'buyTime':
          aVal = a.buyTime;
          bVal = b.buyTime;
          break;
        case 'sellTime':
          aVal = a.sellTime;
          bVal = b.sellTime;
          break;
        case 'durationHeld':
          aVal = a.durationHeld;
          bVal = b.durationHeld;
          break;
        case 'buyCost':
          aVal = a.buyCost ? parseFloat(a.buyCost) : null;
          bVal = b.buyCost ? parseFloat(b.buyCost) : null;
          break;
        case 'poolType':
          aVal = a.poolType;
          bVal = b.poolType;
          break;
        default:
          return 0;
      }

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      const numA = Number(aVal);
      const numB = Number(bVal);
      return sortDir === 'asc' ? numA - numB : numB - numA;
    });
    return copy;
  }, [trades, sortField, sortDir]);

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  const start = (pagination.page - 1) * pagination.limit + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);

  const formatDate = (timestamp: number | null): string => {
    if (timestamp === null) return '--';
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {/* Core columns */}
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('token')}
              >
                Token{sortIndicator('token')}
              </th>
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('chain')}
              >
                Chain{sortIndicator('chain')}
              </th>
              <th className="px-3 py-2 text-xs text-text-muted">Status</th>
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('pnl')}
              >
                P&L{sortIndicator('pnl')}
              </th>
              {/* Timing columns */}
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('buyTime')}
              >
                Buy Time{sortIndicator('buyTime')}
              </th>
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('sellTime')}
              >
                Sell Time{sortIndicator('sellTime')}
              </th>
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('durationHeld')}
              >
                Duration{sortIndicator('durationHeld')}
              </th>
              {/* Amounts columns */}
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('buyCost')}
              >
                Entry Cost{sortIndicator('buyCost')}
              </th>
              <th className="px-3 py-2 text-xs text-text-muted">Exit Revenue</th>
              <th className="px-3 py-2 text-xs text-text-muted">Buy Gas</th>
              <th className="px-3 py-2 text-xs text-text-muted">Sell Gas</th>
              {/* Exit columns */}
              <th
                className="px-3 py-2 text-xs text-text-muted cursor-pointer select-none"
                onClick={() => handleSort('poolType')}
              >
                Pool Type{sortIndicator('poolType')}
              </th>
              <th className="px-3 py-2 text-xs text-text-muted">Fee Tier</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade) => {
              return (
                <tr
                  key={trade.id}
                  className="border-b border-border/50 hover:bg-surface-lighter/30 min-h-[44px]"
                >
                  {/* Core */}
                  <td className="px-3 py-2">
                    <span className="font-mono text-text">{formatAddress(trade.token)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <ChainBadge chain={trade.chain} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                          trade.action === 'closed'
                            ? 'bg-surface-lighter text-text-muted'
                            : 'bg-profit/20 text-profit'
                        }`}
                      >
                        {trade.action === 'closed' ? 'closed' : 'open'}
                      </span>
                      {(trade.sellCount ?? 0) > 1 && (
                        <span className="text-xs text-text-muted">
                          ({trade.sellCount} sells)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`px-3 py-2 font-mono ${pnlColor(trade.pnl)}`}>
                    {formatPnL(trade.pnl)}
                  </td>
                  {/* Timing */}
                  <td className="px-3 py-2 text-text-muted">{formatDate(trade.buyTime)}</td>
                  <td className="px-3 py-2 text-text-muted">{formatDate(trade.sellTime)}</td>
                  <td className="px-3 py-2 text-text-muted">{formatDuration(trade.durationHeld)}</td>
                  {/* Amounts */}
                  <td className="px-3 py-2 font-mono text-text">{formatEth(trade.buyCost)}</td>
                  <td className="px-3 py-2 font-mono text-text">
                    {trade.action === 'closed' && trade.sellRevenue !== null
                      ? formatEth(trade.sellRevenue)
                      : '--'}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-muted">{formatEth(trade.buyGas)}</td>
                  <td className="px-3 py-2 font-mono text-text-muted">
                    {trade.action === 'closed' ? formatEth(trade.sellGas) : '--'}
                  </td>
                  {/* Exit */}
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                        trade.poolType === 'v3'
                          ? 'bg-accent/20 text-accent'
                          : 'bg-surface-lighter text-text-muted'
                      }`}
                    >
                      {trade.poolType.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {trade.poolType === 'v3' && trade.feeTier !== null
                      ? `${trade.feeTier / 10000}%`
                      : '--'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between mt-4 px-3">
        <span className="text-xs text-text-muted">
          Showing {start}-{end} of {pagination.total} trades
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="px-3 py-1.5 text-xs rounded bg-surface-lighter text-text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="px-3 py-1.5 text-xs rounded bg-surface-lighter text-text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
